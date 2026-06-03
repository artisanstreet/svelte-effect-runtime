import { assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { stringify } from "devalue";
import {
  create_remote_form_adapter,
  create_remote_live_query_adapter,
  create_remote_query_adapter,
} from "../../../modules/svelte-effect-runtime/src/remote/client.ts";
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

  const query = create_remote_live_query_adapter<undefined, string>(
    native,
    (value) => value,
    "",
  )(undefined);

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
  const result = await Effect.runPromise(query);

  assertEquals(result, "first");
  assertEquals(reconnect_called, true);
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

Deno.test("remote form adapter preserves enhance submit updates as an Effect", async () => {
  let submit_started = false;
  let updates_called = false;
  let submit_effect: unknown;

  const native = {
    method: "POST",
    action: "?/remote=abc%2Fcreate",
    enhance(callback: (event: unknown) => unknown) {
      callback({
        submit: () => {
          submit_started = true;

          const promise = Promise.resolve("ok") as Promise<string> & {
            updates: (...args: unknown[]) => Promise<string>;
          };

          promise.updates = (...args: unknown[]) => {
            updates_called = args[0] === "refresh";

            return promise;
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

  await Effect.runPromise(
    submit_effect as Effect.Effect<unknown, unknown, unknown>,
  );

  assertEquals(submit_started, true);
  assertEquals(updates_called, true);
});
