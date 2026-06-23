import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Effect } from "effect";
import { stringify } from "devalue";
import {
  create_remote_command_adapter,
  create_remote_form_adapter,
  create_remote_live_query_adapter,
  create_remote_query_adapter,
} from "../../../modules/svelte-effect-runtime/src/remote/client.ts";
import { to_form_data } from "../../../modules/svelte-effect-runtime/src/remote/client/form-data.ts";
import { normalize_native_error } from "../../../modules/svelte-effect-runtime/src/remote/client/failures.ts";
import { create_serialized_remote_failure_envelope } from "../../../modules/svelte-effect-runtime/src/remote/shared.ts";

Deno.test("remote query adapter preserves decoded domain failures", async () => {
  const domain_error = { _tag: "DomainError", message: "nope" };
  const native = {
    load: () =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            create_serialized_remote_failure_envelope(stringify(domain_error)),
          ),
          { status: 500 },
        ),
      ),
  };

  const query = create_remote_query_adapter(native, (value) => value, "");

  const error = await assertRejects(() => Effect.runPromise(query(undefined)));

  assertEquals(error, domain_error);
});

Deno.test("remote failure decoder unwraps SvelteKit message envelopes", () => {
  const domain_error = { _tag: "DomainError", message: "nope" };
  const envelope = create_serialized_remote_failure_envelope(
    stringify(domain_error),
  );
  const error = normalize_native_error({
    body: { message: JSON.stringify(envelope) },
    status: 500,
  });

  assertEquals(error, domain_error);
});

Deno.test("remote failure decoder keeps envelopes with plain messages", () => {
  const domain_error = { _tag: "DomainError", message: "nope" };
  const envelope = {
    ...create_serialized_remote_failure_envelope(stringify(domain_error)),
    message: "Unknown Error",
  };
  const error = normalize_native_error({
    body: envelope,
    status: 500,
  });

  assertEquals(error, domain_error);
});

Deno.test("remote query adapter wraps network failures as transport errors", async () => {
  const native = {
    load: () => Promise.reject(new Error("network")),
  };

  const query = create_remote_query_adapter(native, (value) => value, "");

  const error = await assertRejects(() => Effect.runPromise(query(undefined)));

  assertEquals((error as { _tag?: string })._tag, "RemoteTransportError");
});

Deno.test("remote query adapter prefers callable query over hydratable load", async () => {
  let called_query = false;
  let called_load = false;

  const native = Object.assign(
    (_input: undefined) => {
      called_query = true;

      return Promise.resolve({ source: "query" });
    },
    {
      load: () => {
        called_load = true;

        throw new Error("missing hydratable");
      },
    },
  );

  const query = create_remote_query_adapter<
    undefined,
    { source: string }
  >(native, (value) => value, "");

  const result = await Effect.runPromise(query(undefined));

  assertEquals(result, { source: "query" });
  assertEquals(called_query, true);
  assertEquals(called_load, false);
});

Deno.test("remote query adapter awaits modern thenable resources before legacy run handles", async () => {
  let run_called = false;

  const native = () => {
    const resource = Promise.resolve("ready") as Promise<string> & {
      run: () => never;
    };

    Object.defineProperty(resource, "run", {
      value: () => {
        run_called = true;

        throw new Error("run removed");
      },
    });

    return resource;
  };

  const query = create_remote_query_adapter<undefined, string>(
    native,
    (value) => value,
    "",
  );

  const result = await Effect.runPromise(query(undefined));

  assertEquals(result, "ready");
  assertEquals(run_called, false);
});

Deno.test("remote query adapter maps validation responses to validation errors", async () => {
  const native = {
    load: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            issues: [{ message: "missing", path: ["title"] }],
          }),
          { status: 400 },
        ),
      ),
  };

  const query = create_remote_query_adapter(native, (value) => value, "");

  const error = await assertRejects(() => Effect.runPromise(query(undefined)));

  assertEquals((error as { _tag?: string })._tag, "RemoteValidationError");
  assertEquals((error as { status?: number }).status, 400);
});

Deno.test("remote query adapter maps plain http failures to http errors", async () => {
  const native = {
    load: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ message: "not found" }),
          { status: 404 },
        ),
      ),
  };

  const query = create_remote_query_adapter(native, (value) => value, "");

  const error = await assertRejects(() => Effect.runPromise(query(undefined)));

  assertEquals((error as { _tag?: string })._tag, "RemoteHttpError");
  assertEquals((error as { status?: number }).status, 404);
});

Deno.test("remote query adapter exposes http failures on the Effect error channel", async () => {
  const native = {
    load: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ message: "not found" }),
          { status: 404 },
        ),
      ),
  };

  const query = create_remote_query_adapter(native, (value) => value, "");
  const result = await Effect.runPromise(
    query(undefined).pipe(
      Effect.catchTag(
        "RemoteHttpError",
        (error) => Effect.succeed(error.status),
      ),
    ),
  );

  assertEquals(result, 404);
});

Deno.test("remote query adapter preserves resource state and methods", async () => {
  let refresh_called = false;
  let override_called = false;
  let set_value = 0;

  const native = () => {
    const resource = Promise.resolve(1) as Promise<number> & {
      current: number;
      error: unknown;
      loading: boolean;
      ready: boolean;
      refresh: () => Promise<void>;
      set: (value: number) => void;
      withOverride: (update: (current: number) => number) => () => void;
    };

    Object.defineProperties(resource, {
      current: { get: () => 1 },
      error: { get: () => undefined },
      loading: { get: () => false },
      ready: { get: () => true },
      refresh: {
        value: () => {
          refresh_called = true;

          return Promise.resolve();
        },
      },
      set: {
        value: (value: number) => {
          set_value = value;
        },
      },
      withOverride: {
        value: (update: (current: number) => number) => {
          override_called = update(1) === 2;

          return () => {};
        },
      },
    });

    return resource;
  };

  const query = create_remote_query_adapter<undefined, number>(
    native,
    (value) => value,
    "",
  )(undefined);

  assertEquals(query.current, 1);
  assertEquals(query.loading, false);
  assertEquals(query.ready, true);
  assertEquals(Effect.isEffect(query.refresh()), true);

  query.set(7);
  query.withOverride((current) => current + 1);

  await Effect.runPromise(query.refresh());
  const result = await Effect.runPromise(query);

  assertEquals(result, 1);
  assertEquals(refresh_called, true);
  assertEquals(set_value, 7);
  assertEquals(override_called, true);
});

Deno.test("remote live query adapter preserves state and wraps reconnect", async () => {
  let reconnect_called = false;

  const native = () => {
    const resource = Promise.resolve("first") as Promise<string> & {
      connected: boolean;
      current: string;
      done: boolean;
      error: unknown;
      loading: boolean;
      ready: boolean;
      reconnect: () => Promise<void>;
      [Symbol.asyncIterator]: () => AsyncIterator<string>;
    };

    Object.defineProperties(resource, {
      [Symbol.asyncIterator]: {
        value: async function* () {
          yield "first";
          yield "second";
        },
      },
      connected: { get: () => true },
      current: { get: () => "first" },
      done: { get: () => false },
      error: { get: () => undefined },
      loading: { get: () => false },
      ready: { get: () => true },
      reconnect: {
        value: () => {
          reconnect_called = true;

          return Promise.resolve();
        },
      },
    });

    return resource;
  };

  const query_effect = create_remote_live_query_adapter<undefined, string>(
    native,
    (value) => value,
    "",
  )(undefined);
  const query = await Effect.runPromise(query_effect);

  const values: string[] = [];

  for await (const value of query) {
    values.push(value);
  }

  assertEquals(query.connected, true);
  assertEquals(query.current, "first");
  assertEquals(query.done, false);
  assertEquals(query.ready, true);
  assertEquals(Effect.isEffect(query.reconnect()), true);
  assertEquals(values, ["first", "second"]);

  await Effect.runPromise(query.reconnect());

  assertEquals(reconnect_called, true);
});

Deno.test("remote command adapter resolves callable responses and tracks pending", async () => {
  let release: (() => void) | undefined;
  let pending_while_running = 0;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const native = async (input: { title: string }) => {
    pending_while_running = command.pending;

    await gate;

    return new Response(JSON.stringify({ ok: input.title }));
  };

  const command = create_remote_command_adapter(native, (value) => value);

  const promise = Effect.runPromise(command({ title: "publish" }));

  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(command.pending, 1);
  assertEquals(pending_while_running, 1);

  release?.();

  const result = await promise;

  assertEquals(result, { ok: "publish" });
  assertEquals(command.pending, 0);
});

Deno.test("remote command adapter decodes empty successful responses", async () => {
  const native = () => Promise.resolve(new Response(null, { status: 204 }));
  const command = create_remote_command_adapter<void, void>(
    native,
    (value) => value,
  );

  const result = await Effect.runPromise(command(undefined));

  assertEquals(result, undefined);
});

Deno.test("remote command adapter supports invoke objects and rejects invalid factories", async () => {
  const native = {
    invoke(input: { id: number }) {
      return Promise.resolve({ id: input.id, source: "invoke" });
    },
  };

  const command = create_remote_command_adapter<
    { id: number },
    { id: number; source: string }
  >(native, (value) => value);

  const result = await Effect.runPromise(command({ id: 7 }));

  assertEquals(result, { id: 7, source: "invoke" });
  assertThrows(
    () => {
      create_remote_command_adapter({}, (value) => value);
    },
    Error,
    "Invalid command factory",
  );
});

Deno.test("remote form data encodes nested scalar, array, blob, and empty values", () => {
  const blob = new Blob(["avatar"]);
  const form_data = to_form_data({
    active: true,
    avatar: blob,
    count: 2,
    draft: false,
    nested: {
      missing: undefined,
      nil: null,
    },
    tags: ["svelte", "effect"],
    title: "Hello",
  });

  assertEquals(form_data.get("title"), "Hello");
  assertEquals(form_data.get("n:count"), "2");
  assertEquals(form_data.get("b:active"), "on");
  assertEquals(form_data.has("b:draft"), false);
  assertEquals(form_data.getAll("tags[]"), ["svelte", "effect"]);
  assertEquals(form_data.get("nested.nil"), "");
  assertEquals(form_data.has("nested.missing"), false);
  assertEquals(form_data.get("avatar") instanceof Blob, true);
});

Deno.test("remote form adapter preserves descriptors and wraps validate in an Effect", async () => {
  const attach = Symbol("attach");
  let validate_called = false;

  const native: Record<PropertyKey, unknown> = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
  };

  Object.defineProperty(native, "enhance", {
    value: () => ({ method: "POST", [attach]: "attached" }),
  });

  Object.defineProperty(native, "validate", {
    value: () => {
      validate_called = true;
      return Promise.resolve();
    },
  });

  Object.defineProperty(native, attach, {
    enumerable: false,
    value: "root-attachment",
  });

  const form = create_remote_form_adapter(native, (value) => value, "");

  assertEquals(Reflect.ownKeys(form).includes(attach), true);
  assertEquals(typeof form.enhance, "function");
  assertEquals(form.method, "POST");
  assertEquals(form.action, "?/remote=abc%2Fcreate");

  await Effect.runPromise(form.validate());

  assertEquals(validate_called, true);
});

Deno.test("remote form adapter posts explicit input when native submit is form-bound", async () => {
  const original_fetch = globalThis.fetch;

  let native_submit_called = false;
  let requested_url = "";
  let posted_title: FormDataEntryValue | null = null;

  const native = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
    submit() {
      native_submit_called = true;
      throw new Error("Cannot call submit() before the form is attached");
    },
  };

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    requested_url = String(url);
    posted_title = (init?.body as FormData).get("title");

    return Promise.resolve(
      new Response(
        JSON.stringify({
          type: "result",
          result: stringify({ result: { ok: true } }),
        }),
      ),
    );
  }) as typeof fetch;

  try {
    const form = create_remote_form_adapter<
      { title: string },
      { ok: boolean }
    >(native, (value) => value, "/_app/remote");

    const result = await Effect.runPromise(form({ title: "hello" }));

    assertEquals(result, { ok: true });
    assertEquals(native_submit_called, false);
    assertEquals(requested_url, "/_app/remote/abc/create");
    assertEquals(posted_title, "hello");
  } finally {
    globalThis.fetch = original_fetch;
  }
});

Deno.test("remote form adapter decodes SvelteKit data result envelopes", async () => {
  const original_fetch = globalThis.fetch;

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          type: "result",
          data: stringify({ result: { ok: true } }),
        }),
      ),
    )) as typeof fetch;

  try {
    const form = create_remote_form_adapter<
      { title: string },
      { ok: boolean }
    >(
      {
        method: "POST",
        action: "?/remote=abc%2Fcreate",
      },
      (value) => value,
      "/_app/remote",
    );

    const result = await Effect.runPromise(form({ title: "hello" }));

    assertEquals(result, { ok: true });
  } finally {
    globalThis.fetch = original_fetch;
  }
});

Deno.test("remote form adapter uses native submit when no remote endpoint is configured", async () => {
  let submitted_title = "";

  const native = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
    submit(input: { title: string }) {
      submitted_title = input.title;

      return Promise.resolve(`native ${input.title}`);
    },
  };

  const form = create_remote_form_adapter<{ title: string }, string>(
    native,
    (value) => value,
    "",
  );

  const result = await Effect.runPromise(form({ title: "draft" }));

  assertEquals(result, "native draft");
  assertEquals(submitted_title, "draft");
});

Deno.test("remote form adapter reports transport errors without submit or endpoint", async () => {
  const form = create_remote_form_adapter<{ title: string }, string>(
    { method: "POST" },
    (value) => value,
    "",
  );

  const error = await assertRejects(() =>
    Effect.runPromise(form({ title: "draft" }))
  );

  assertEquals((error as { _tag?: string })._tag, "RemoteTransportError");
});

Deno.test("remote form adapter maps endpoint validation issues to the Effect error channel", async () => {
  const original_fetch = globalThis.fetch;

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          type: "result",
          result: stringify({
            issues: [{ message: "Title too short", path: ["title"] }],
          }),
        }),
      ),
    )) as typeof fetch;

  try {
    const form = create_remote_form_adapter<{ title: string }, string>(
      {
        method: "POST",
        action: "?/remote=abc%2Fcreate",
      },
      (value) => value,
      "/_app/remote",
    );

    const error = await assertRejects(() =>
      Effect.runPromise(form({ title: "x" }))
    );

    assertEquals((error as { _tag?: string })._tag, "RemoteValidationError");
    assertEquals(
      (error as { issues?: Array<{ message: string }> }).issues?.[0]?.message,
      "Title too short",
    );
  } finally {
    globalThis.fetch = original_fetch;
  }
});

Deno.test("remote form adapter returns keyed forms from nested for calls", async () => {
  const keys: Array<string | number | boolean> = [];
  const native = {
    method: "POST",
    action: "?/remote=abc%2Froot",
    for(key: string | number | boolean) {
      keys.push(key);

      return {
        method: "POST",
        action: `?/remote=abc%2F${key}`,
        submit(input: { title: string }) {
          return Promise.resolve(`${key}:${input.title}`);
        },
      };
    },
  };

  const form = create_remote_form_adapter<{ title: string }, string>(
    native,
    (value) => value,
    "",
  );

  const child = form.for("profile");
  const result = await Effect.runPromise(child({ title: "saved" }));

  assertEquals(keys, ["profile"]);
  assertEquals(child.action, "?/remote=abc%2Fprofile");
  assertEquals(result, "profile:saved");
});

Deno.test("remote form adapter preflight calls native preflight and keeps callable", async () => {
  const schemas: unknown[] = [];
  const schema = { name: "draft" };
  const native = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
    preflight(next_schema: unknown) {
      schemas.push(next_schema);

      return native;
    },
    submit(input: { title: string }) {
      return Promise.resolve(input.title);
    },
  };

  const form = create_remote_form_adapter<{ title: string }, string>(
    native,
    (value) => value,
    "",
  );

  const preflighted = form.preflight(schema);
  const result = await Effect.runPromise(preflighted({ title: "ok" }));

  assertEquals(preflighted, form);
  assertEquals(schemas, [schema]);
  assertEquals(result, "ok");
});

Deno.test("remote form adapter preserves SvelteKit 2.61 enhance instance descriptors", () => {
  const fields = { title: { value: () => "draft" } };

  let callback_fields: unknown;
  let callback_pending: unknown;
  let callback_submit_is_effect = false;

  const native = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
    enhance(callback: (event: unknown) => unknown) {
      const event = {};

      Object.defineProperties(event, {
        fields: {
          get: () => fields,
        },
        pending: {
          get: () => 1,
        },
        submit: {
          value: () => Promise.resolve(true),
        },
      });

      callback(event);

      return native;
    },
  };

  const form = create_remote_form_adapter(native, (value) => value, "");

  form.enhance((event: unknown) => {
    const wrapped = event as {
      fields: unknown;
      pending: number;
      submit: () => unknown;
    };

    callback_fields = wrapped.fields;
    callback_pending = wrapped.pending;
    callback_submit_is_effect = Effect.isEffect(wrapped.submit());
  });

  assertEquals(callback_fields, fields);
  assertEquals(callback_pending, 1);
  assertEquals(callback_submit_is_effect, true);
});

Deno.test("remote form adapter wraps enhance submit callbacks as Effects", () => {
  let callback_submit_is_effect = false;

  const native = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
    enhance(callback: (event: unknown) => unknown) {
      callback({
        submit: () => Promise.resolve("ok"),
      });

      return { method: "POST" };
    },
  };

  const form = create_remote_form_adapter(native, (value) => value, "");

  form.enhance((event: unknown) => {
    const result = (event as { submit: () => unknown }).submit();
    callback_submit_is_effect = Effect.isEffect(result);
  });

  assertEquals(callback_submit_is_effect, true);
});

Deno.test("remote form adapter resolves enhance submit to form result", async () => {
  let submit_effect: unknown;
  let form_result: { id: string } | undefined;

  const native = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
    get result() {
      return form_result;
    },
    enhance(callback: (event: unknown) => unknown) {
      callback({
        get result() {
          return form_result;
        },
        submit: () => {
          form_result = { id: "created" };

          return Promise.resolve(true);
        },
      });

      return { method: "POST" };
    },
  };

  const form = create_remote_form_adapter(native, (value) => value, "");

  form.enhance((event: unknown) => {
    submit_effect = (event as { submit: () => unknown }).submit();
  });

  const result = await Effect.runPromise(
    submit_effect as Effect.Effect<
      { id: string } | undefined,
      unknown,
      unknown
    >,
  );

  assertEquals(result, { id: "created" });
});

Deno.test("remote form adapter preserves enhance submit updates as an Effect", async () => {
  let submit_started = false;
  let updates_called = false;
  let submit_effect: unknown;
  let form_result: { id: string } | undefined;

  const native = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
    enhance(callback: (event: unknown) => unknown) {
      callback({
        get result() {
          return form_result;
        },
        submit: () => {
          submit_started = true;

          const promise = Promise.resolve(true) as Promise<boolean> & {
            updates: (...args: unknown[]) => Promise<boolean>;
          };

          promise.updates = (...args: unknown[]) => {
            updates_called = args[0] === "refresh";
            form_result = { id: "updated" };

            return Promise.resolve(true);
          };

          return promise;
        },
      });

      return { method: "POST" };
    },
  };

  const form = create_remote_form_adapter(native, (value) => value, "");

  form.enhance((event: unknown) => {
    submit_effect = (event as {
      submit: () => {
        updates: (...args: unknown[]) => unknown;
      };
    }).submit().updates("refresh");
  });

  assertEquals(Effect.isEffect(submit_effect), true);
  assertEquals(submit_started, false);

  const result = await Effect.runPromise(
    submit_effect as Effect.Effect<
      { id: string } | undefined,
      unknown,
      unknown
    >,
  );

  assertEquals(result, { id: "updated" });
  assertEquals(submit_started, true);
  assertEquals(updates_called, true);
});
