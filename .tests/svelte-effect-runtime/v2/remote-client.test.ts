import { assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { stringify } from "devalue";
import {
  create_remote_form_adapter,
  create_remote_query_adapter,
} from "../../../modules/svelte-effect-runtime/src/remote/client.ts";
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

Deno.test("remote query adapter wraps network failures as transport errors", async () => {
  const native = {
    load: () => Promise.reject(new Error("network")),
  };

  const query = create_remote_query_adapter(native, (value) => value, "");

  const error = await assertRejects(() => Effect.runPromise(query(undefined)));

  assertEquals((error as { _tag?: string })._tag, "RemoteTransportError");
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
