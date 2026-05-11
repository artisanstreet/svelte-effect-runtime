import { assertEquals, assertExists } from "@std/assert";
import * as devalue from "devalue";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { to_transportable_data } from "$internal/effect-compat.ts";
import {
  create_remote_command_adapter,
  create_remote_form_adapter,
  create_remote_query_adapter,
} from "$internal/remote-client.ts";
import {
  EFFECT_REMOTE_ERROR_MARKER,
  type FormIssue,
} from "$internal/remote-shared.ts";
import { installDom } from "$tests/shared/support.ts";
import type { VersionHarness } from "$tests/shared/versions.ts";

export function register_remote_behaviors(harness: VersionHarness): void {
  const { label } = harness;
  const create_effect_transport = harness.server
    .create_effect_transport as typeof import("$/v3/server.ts")[
      "create_effect_transport"
    ];
  const to_effect = harness.client
    .to_effect as typeof import("$/v3/client.ts")[
      "to_effect"
    ];
  const to_native = harness.client
    .to_native as typeof import("$/v3/client.ts")[
      "to_native"
    ];

  function create_form_dependencies() {
    return {
      app: {},
      app_dir: "_app",
      apply_refreshes() {},
      base: "",
      binary_form_content_type: "application/octet-stream",
      get_remote_request_headers() {
        return {};
      },
      goto() {},
      invalidate_all() {},
      remote_request() {
        return Promise.resolve("");
      },
      serialize_binary_form() {
        return {
          blob: new Blob(),
        };
      },
      stringify_remote_arg() {
        return "";
      },
    };
  }

  Deno.test(`[${label}] create_effect_transport round-trips schema-backed classes`, () => {
    class Post extends Schema.Class<Post>("Post")({
      id: Schema.Number,
      title: Schema.String,
    }) {}

    const transport = create_effect_transport({ Post });
    const encoded = transport.Post.encode(new Post({ id: 1, title: "hello" }));

    assertExists(encoded);

    const decoded = transport.Post.decode(
      encoded as { value: unknown },
    ) as Post;

    assertEquals(decoded instanceof Post, true);
    assertEquals(decoded.title, "hello");
  });

  Deno.test(`[${label}] tagged Effect failures stay transportable through devalue`, () => {
    class ProviderBusyError extends Data.TaggedError("ProviderBusyError")<{
      readonly provider: string;
      readonly retryAfterMs: number;
    }> {}

    const encoded = devalue.stringify(
      to_transportable_data(
        new ProviderBusyError({
          provider: "github",
          retryAfterMs: 1500,
        }),
      ),
    );
    const decoded = devalue.parse(encoded) as {
      readonly _tag: string;
      readonly provider: string;
      readonly retryAfterMs: number;
    };

    assertEquals(decoded._tag, "ProviderBusyError");
    assertEquals(decoded.provider, "github");
    assertEquals(decoded.retryAfterMs, 1500);
  });

  Deno.test(`[${label}] query adapters decode domain failures into the Effect error channel`, async () => {
    const payload = {
      _tag: "Conflict",
      id: "post-1",
    };
    const encoded = devalue.stringify(payload);
    const query_factory = create_remote_query_adapter(
      () => () =>
        Promise.reject({
          body: {
            [EFFECT_REMOTE_ERROR_MARKER]: true,
            encoded,
            message: "Effect remote failure",
          },
          status: 409,
        }),
      (serialized) => devalue.parse(serialized),
    );
    const get_post = query_factory("hash/get_post") as (
      id: string,
    ) => Effect.Effect<
      unknown,
      {
        _tag: string;
        id: string;
      },
      never
    >;

    const exit = await Effect.runPromiseExit(get_post("post-1"));

    assertEquals(Exit.isFailure(exit), true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected query effect to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    assertEquals(Option.isSome(failure), true);
    assertEquals(Option.getOrUndefined(failure), payload);

    assertEquals(to_native(get_post) instanceof Function, true);
  });

  Deno.test(`[${label}] query adapters preserve tagged remote failures for catchTag`, async () => {
    const payload = {
      _tag: "ProviderBusyError",
      provider: "github",
      retryAfterMs: 1500,
    };
    const encoded = devalue.stringify(payload);
    const query_factory = create_remote_query_adapter(
      () => () =>
        Promise.reject({
          body: {
            [EFFECT_REMOTE_ERROR_MARKER]: true,
            encoded,
            message: "Effect remote failure",
          },
          status: 503,
        }),
      (serialized) => devalue.parse(serialized),
    );
    const get_provider = query_factory("hash/get_provider") as () =>
      Effect.Effect<
        unknown,
        {
          readonly _tag: "ProviderBusyError";
          readonly provider: string;
          readonly retryAfterMs: number;
        },
        never
      >;

    const result = await Effect.runPromise(
      get_provider().pipe(
        Effect.catchTag("ProviderBusyError", (error) =>
          Effect.succeed({
            matchedTag: error._tag,
            provider: error.provider,
            retryAfterMs: error.retryAfterMs,
          })),
      ),
    );

    assertEquals(result, {
      matchedTag: "ProviderBusyError",
      provider: "github",
      retryAfterMs: 1500,
    });
  });

  Deno.test(`[${label}] to_effect preserves typed remote failures for native remote calls`, async () => {
    const payload = {
      _tag: "Conflict",
      id: "post-1",
    };
    const encoded = devalue.stringify(payload);
    const query_factory = create_remote_query_adapter(
      () => () =>
        Promise.reject({
          body: {
            [EFFECT_REMOTE_ERROR_MARKER]: true,
            encoded,
            message: "Effect remote failure",
          },
          status: 409,
        }),
      (serialized) => devalue.parse(serialized),
    );
    const get_post = query_factory("hash/get_post") as unknown as {
      native: (id: string) => Promise<unknown>;
    };
    const exit = await Effect.runPromiseExit(
      to_effect<unknown, { _tag: string; id: string }>(
        get_post.native("post-1"),
      ),
    );

    assertEquals(Exit.isFailure(exit), true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected native remote effect to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    assertEquals(Option.isSome(failure), true);
    assertEquals(Option.getOrUndefined(failure), payload);
  });

  Deno.test(`[${label}] command adapters proxy pending state and preserve native access`, () => {
    const native_command = Object.assign(
      (_arg?: unknown) => Promise.resolve({ ok: true }),
      {
        pending: 2,
      },
    );
    const command_factory = create_remote_command_adapter(
      () => native_command,
      (serialized) => devalue.parse(serialized),
    );
    const command = command_factory("hash/command") as unknown as {
      readonly pending: number;
      readonly native: typeof native_command;
    };

    assertEquals(command.pending, 2);
    assertEquals(to_native(command), native_command);
  });

  Deno.test(`[${label}] form adapters reuse native form state on success`, async () => {
    const dom = installDom();

    try {
      const attachment = Symbol("attachment");
      const native_form = {
        action: "http://localhost/?/remote=hash%2Fcreate_post",
        fields: {
          allIssues: [] as Array<FormIssue>,
        },
        method: "POST",
        result: undefined as { slug: string } | undefined,
        enhance(
          callback: (args: {
            readonly form: HTMLFormElement;
            readonly data: unknown;
            readonly submit: () => Promise<void>;
          }) => Promise<void> | void,
        ) {
          return {
            [attachment]: (form: HTMLFormElement) => {
              const handle_submit = async (event: Event) => {
                event.preventDefault();
                await callback({
                  form,
                  data: {},
                  submit: () =>
                    Promise.resolve().then(() => {
                      native_form.fields.allIssues = [];
                      native_form.result = { slug: "hello" };
                    }),
                });
              };

              form.addEventListener("submit", handle_submit);
              return () => form.removeEventListener("submit", handle_submit);
            },
            action: native_form.action,
            method: native_form.method,
          };
        },
      };
      const form_factory = create_remote_form_adapter(
        () => native_form,
        (serialized) => devalue.parse(serialized),
        create_form_dependencies(),
      );
      const create_post = form_factory("hash/create_post") as {
        readonly native: typeof native_form;
        submit(input: {
          body: string;
          title: string;
        }): Effect.Effect<
          {
            slug: string;
          },
          unknown,
          never
        >;
      };
      const result = await Effect.runPromise(
        create_post.submit({
          body: "world",
          title: "hello",
        }),
      );

      assertEquals(result, { slug: "hello" });
      assertEquals(native_form.result, { slug: "hello" });
      assertEquals(to_native(create_post), native_form);
    } finally {
      dom.cleanup();
    }
  });

  Deno.test(`[${label}] form adapters surface native validation issues`, async () => {
    const dom = installDom();

    try {
      const attachment = Symbol("attachment");
      const native_form = {
        action: "http://localhost/?/remote=hash%2Fcreate_post",
        fields: {
          allIssues: [] as Array<FormIssue>,
        },
        method: "POST",
        result: undefined as { slug: string } | undefined,
        enhance(
          callback: (args: {
            readonly form: HTMLFormElement;
            readonly data: unknown;
            readonly submit: () => Promise<void>;
          }) => Promise<void> | void,
        ) {
          return {
            [attachment]: (form: HTMLFormElement) => {
              const handle_submit = async (event: Event) => {
                event.preventDefault();
                await callback({
                  form,
                  data: {},
                  submit: () =>
                    Promise.resolve().then(() => {
                      native_form.fields.allIssues = [{
                        message: "title too short",
                        path: ["title"],
                      }];
                      native_form.result = undefined;
                    }),
                });
              };

              form.addEventListener("submit", handle_submit);
              return () => form.removeEventListener("submit", handle_submit);
            },
            action: native_form.action,
            method: native_form.method,
          };
        },
      };
      const form_factory = create_remote_form_adapter(
        () => native_form,
        (serialized) => devalue.parse(serialized),
        create_form_dependencies(),
      );
      const create_post = form_factory("hash/create_post") as {
        submit(input: {
          body: string;
          title: string;
        }): Effect.Effect<
          {
            slug: string;
          },
          unknown,
          never
        >;
      };
      const exit = await Effect.runPromiseExit(
        create_post.submit({
          body: "world",
          title: "hi",
        }),
      );

      assertEquals(Exit.isFailure(exit), true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected programmatic form submit to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      assertEquals(Option.isSome(failure), true);
      assertEquals(Option.getOrUndefined(failure), {
        _tag: "RemoteValidationError",
        body: [{
          message: "title too short",
          path: ["title"],
        }],
        issues: [{
          message: "title too short",
          path: ["title"],
        }],
        status: 400,
      });
    } finally {
      dom.cleanup();
    }
  });

  Deno.test(`[${label}] form adapters expose a SvelteKit-compatible spread shape`, () => {
    const attachment = Symbol("@attach");
    const native_form: Record<string | symbol, unknown> = {};

    native_form.method = "POST";
    Object.defineProperty(native_form, "action", {
      configurable: true,
      enumerable: true,
      get: () => "?/remote=hash%2Fcreate_post",
    });
    Object.defineProperty(native_form, "fields", {
      configurable: true,
      enumerable: false,
      get: () => ({ allIssues: [] }),
    });
    Object.defineProperty(native_form, "result", {
      configurable: true,
      enumerable: false,
      get: () => undefined,
    });
    Object.defineProperty(native_form, "pending", {
      configurable: true,
      enumerable: false,
      get: () => 0,
    });
    Object.defineProperty(native_form, "enhance", {
      configurable: true,
      enumerable: false,
      value: () => ({ method: "POST", action: "?/remote=hash%2Fcreate_post" }),
    });
    native_form[attachment] = (_form: HTMLFormElement) => () => {};

    const form_factory = create_remote_form_adapter(
      () => native_form,
      (serialized) => devalue.parse(serialized),
      create_form_dependencies(),
    );
    const create_post = form_factory("hash/create_post") as Record<
      string | symbol,
      unknown
    >;

    const string_keys = Object.keys(create_post).sort();
    assertEquals(string_keys, ["action", "method"]);

    const enumerable_symbol_keys = Object.getOwnPropertySymbols(create_post)
      .filter(
        (key) => Object.getOwnPropertyDescriptor(create_post, key)?.enumerable,
      );
    assertEquals(enumerable_symbol_keys.length, 1);
    assertEquals(enumerable_symbol_keys[0].description, "@attach");

    const method_descriptor =
      Object.getOwnPropertyDescriptor(create_post, "method");
    assertEquals(method_descriptor?.enumerable, true);
    assertEquals(method_descriptor?.value, "POST");

    const action_descriptor =
      Object.getOwnPropertyDescriptor(create_post, "action");
    assertEquals(action_descriptor?.enumerable, true);
    assertEquals(typeof action_descriptor?.get, "function");
    assertEquals(
      (action_descriptor?.get as () => unknown)(),
      "?/remote=hash%2Fcreate_post",
    );

    for (const key of ["native", "submit", "fields", "result", "pending"]) {
      const desc = Object.getOwnPropertyDescriptor(create_post, key);
      assertEquals(
        desc?.enumerable,
        false,
        `expected ${key} to be non-enumerable`,
      );
    }

    const spread: Record<string | symbol, unknown> = { ...create_post };
    assertEquals(spread.method, "POST");
    assertEquals(spread.action, "?/remote=hash%2Fcreate_post");
    assertEquals(typeof spread[enumerable_symbol_keys[0]], "function");
  });

  Deno.test(`[${label}] form adapters wrap non-configurable for() accessors`, () => {
    const child_form = {
      action: "http://localhost/?/remote=hash%2Fcreate_post%2Fchild",
      fields: {
        allIssues: [] as Array<FormIssue>,
      },
      method: "POST",
      result: undefined as { slug: string } | undefined,
    };
    const native_form = {
      action: "http://localhost/?/remote=hash%2Fcreate_post",
      fields: {
        allIssues: [] as Array<FormIssue>,
      },
      method: "POST",
      result: undefined as { slug: string } | undefined,
    } as Record<string, unknown>;

    Object.defineProperty(native_form, "for", {
      configurable: false,
      value: (key: string | number) => ({
        ...child_form,
        action: `http://localhost/?/remote=hash%2Fcreate_post%2F${String(key)}`,
      }),
    });

    const form_factory = create_remote_form_adapter(
      () => native_form,
      (serialized) => devalue.parse(serialized),
      create_form_dependencies(),
    );
    const create_post = form_factory("hash/create_post") as {
      readonly native: typeof native_form;
      for(key: string | number): {
        readonly native: Record<string, unknown>;
        submit(input: unknown): Effect.Effect<unknown, unknown, never>;
      };
    };

    const child = create_post.for("nested");

    assertEquals(typeof child.submit, "function");
    assertEquals(
      child.native.action,
      "http://localhost/?/remote=hash%2Fcreate_post%2Fnested",
    );
    assertEquals(to_native(create_post), native_form);
  });

  Deno.test(`[${label}] form adapters use the attached native form instance when present`, async () => {
    const dom = installDom();

    try {
      const attachment = Symbol("attachment");
      let enhance_called = false;
      let current_title = "";
      const native_form = {
        action: "http://localhost/?/remote=hash%2Fcreate_post",
        fields: {
          allIssues: [] as Array<FormIssue>,
          title: {
            set(value: unknown) {
              current_title = String(value);
            },
          },
        },
        pending: 0,
        result: undefined as { slug: string } | undefined,
        [attachment](form: HTMLFormElement) {
          const handle_submit = (event: Event) => {
            event.preventDefault();
            native_form.pending = 1;

            queueMicrotask(() => {
              native_form.fields.allIssues = current_title.length === 0
                ? [{
                  message: "title required",
                  path: ["title"],
                }]
                : [];
              native_form.result = current_title.length === 0
                ? undefined
                : { slug: current_title };
              native_form.pending = 0;
            });
          };

          form.addEventListener("submit", handle_submit);
          return () => form.removeEventListener("submit", handle_submit);
        },
        enhance() {
          enhance_called = true;
          throw new Error("attached submit should not call enhance()");
        },
      };
      const form_factory = create_remote_form_adapter(
        () => native_form,
        (serialized) => devalue.parse(serialized),
        create_form_dependencies(),
      );
      const create_post = form_factory("hash/create_post") as
        & Record<string | symbol, unknown>
        & {
          submit(
            input: { title: string },
          ): Effect.Effect<{ slug: string }, unknown, never>;
        };
      const form = document.createElement("form");
      const button = document.createElement("button");
      button.type = "submit";
      form.append(button);
      document.body.append(form);

      const attach = Object.getOwnPropertySymbols(create_post)
        .map((key) => create_post[key])
        .find((value) => typeof value === "function") as
          | ((form: HTMLFormElement) => void | (() => void))
          | undefined;

      if (!attach) {
        throw new Error("Expected wrapped form attachment.");
      }

      const detach = attach(form);
      const result = await Effect.runPromise(
        create_post.submit({
          title: "hello",
        }),
      );

      assertEquals(result, { slug: "hello" });
      assertEquals(enhance_called, false);

      if (typeof detach === "function") {
        detach();
      }

      form.remove();
    } finally {
      dom.cleanup();
    }
  });
}
