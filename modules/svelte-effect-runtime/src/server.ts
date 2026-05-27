import {
  command as native_command,
  form as native_form,
  getRequestEvent as get_native_request_event,
  prerender as native_prerender,
  query as native_query,
} from "$app/server";
import {
  normalize_remote_helper_error,
  run_remote_effect,
} from "$/remote/server.ts";
import { create_form_error } from "$/remote/shared.ts";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { error as svelte_error, invalid } from "@sveltejs/kit";
import type { FormIssue } from "$/remote/shared.ts";

/**
 * SvelteKit's `RequestEvent` exposed as an Effect {@link Context.Tag} so
 * remote handlers can `yield* RequestEvent` to access the raw event inside
 * their Effect programs.
 *
 * @example
 * ```ts
 * const hello = Query(() =>
 *   Effect.gen(function* () {
 *     const event = yield* RequestEvent;
 *     return event.url.searchParams.get("name") ?? "world";
 *   })
 * );
 * ```
 *
 * @since 2.0.0
 */
export const RequestEvent: Context.Reference<RequestEvent> = Context.Reference<
  RequestEvent
>("@ser/RequestEvent", {
  defaultValue: () => {
    throw new Error("RequestEvent is only available during a remote call");
  },
});

/**
 * Subset of SvelteKit's `RequestEvent` that remote handlers typically
 * access. The full event is available via `yield* RequestEvent`.
 *
 * @since 2.0.0
 */
export interface RequestEvent {
  readonly url: URL;
  readonly request: Request;
  readonly cookies: {
    get(name: string): string | undefined;
    set(name: string, value: string, opts?: Record<string, unknown>): void;
    delete(name: string, opts?: Record<string, unknown>): void;
    serialize(
      name: string,
      value: string,
      opts?: Record<string, unknown>,
    ): string;
  };
  readonly locals: Record<string, unknown>;
  readonly params: Record<string, string>;
  readonly route: { id: string | null };
  readonly platform?: unknown;
  readonly getClientAddress: () => string;
}

/**
 * Builder for the server-side Effect runtime. Every remote handler runs
 * its Effect through a `ManagedRuntime`. Call `ServerRuntime.make()` to
 * configure the runtime with layers.
 *
 * @example
 * ```ts
 * import { ServerRuntime } from "svelte-effect-runtime/server";
 * import { Db } from "./db.ts";
 *
 * ServerRuntime.make(Db.Live);
 * ```
 *
 * @since 2.0.0
 */
export class ServerRuntime {
  /**
   * Build and cache the server-side `ManagedRuntime`.
   *
   * @since 2.0.0
   * @param layer - An optional Effect layer to provide to the runtime.
   * @returns The configured ManagedRuntime.
   */
  static make<R = never>(
    layer?: Layer.Layer<R>,
  ): ManagedRuntime.ManagedRuntime<R, never> {
    const runtime = ManagedRuntime.make(
      layer ?? (Layer.empty as unknown as Layer.Layer<R>),
    );

    current_server_runtime = runtime as ManagedRuntime.ManagedRuntime<
      unknown,
      never
    >;

    return runtime;
  }
}

let current_server_runtime:
  | ManagedRuntime.ManagedRuntime<unknown, never>
  | undefined;

const svelte_invalid = (_status: number, body: unknown): never => {
  const issues = typeof body === "object" && body !== null &&
      Array.isArray((body as { issues?: unknown }).issues)
    ? (body as { issues: unknown[] }).issues
    : [String(body)];

  invalid(...(issues as never[]));
};

const svelte_remote_error = (status: number, body: unknown): never => {
  svelte_error(status as never, body as never);
};

/**
 * Returns the active server runtime, lazily creating a default
 * empty-layer runtime if none has been configured.
 *
 * @example
 * ```ts
 * const runtime = get_server_runtime_or_throw();
 * const result = await runtime.runPromise(myEffect);
 * ```
 *
 * @since 2.0.0
 * @internal
 * @returns The current ManagedRuntime instance.
 */
export function get_server_runtime_or_throw(): ManagedRuntime.ManagedRuntime<
  unknown,
  never
> {
  if (!current_server_runtime) {
    current_server_runtime = ManagedRuntime.make(
      Layer.empty,
    ) as ManagedRuntime.ManagedRuntime<unknown, never>;
  }

  return current_server_runtime;
}

type EffectLike<A = unknown> =
  | Effect.Effect<A, unknown>
  | Effect.gen.Return<A, unknown, unknown>;

type RemoteHandler<Input = unknown, A = unknown> = (
  input: Input,
) => EffectLike<A>;

type RemoteFormHandler<Input = unknown, A = unknown> = (
  input: {
    readonly data: Input;
    readonly invalid: FormInvalid;
    readonly issue: unknown;
  },
) => EffectLike<A>;

type FormInvalid =
  & {
    readonly [key: string]: FormInvalid;
  }
  & ((
    message: string,
  ) => Effect.Effect<never, ReturnType<typeof create_form_error>>);

type PrerenderOptions = {
  readonly inputs?: unknown;
  readonly dynamic?: boolean;
};

function is_generator_result<A>(
  value: unknown,
): value is Effect.gen.Return<A, unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { next?: unknown }).next === "function"
  );
}

function to_effect<A>(
  value: EffectLike<A>,
): Effect.Effect<A, unknown, unknown> {
  if (is_generator_result<A>(value)) {
    return Effect.gen(() => value);
  }

  return value;
}

function run_handler_effect<A>(
  value: EffectLike<A>,
  event: RequestEvent,
): Promise<A> {
  const runtime = get_server_runtime_or_throw();
  const effect = Effect.provideService(
    to_effect(value),
    RequestEvent,
    event,
  ) as Effect.Effect<A, unknown, unknown>;

  return run_remote_effect(
    effect,
    runtime,
    svelte_invalid,
    svelte_remote_error,
  );
}

/**
 * Builds a wrapper passed to SvelteKit's native query, command, and
 * prerender factories. The wrapper reads the current request event from
 * SvelteKit's request store and provides it to the Effect environment.
 */
function make_remote_wrapper(
  handler: RemoteHandler,
  helper_name: string,
): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    try {
      const event = get_native_request_event() as unknown as RequestEvent;
      const result = handler(input);

      return await run_handler_effect(result, event);
    } catch (error: unknown) {
      throw normalize_remote_helper_error(error, helper_name);
    }
  };
}

function make_remote_form_wrapper(
  handler: RemoteFormHandler,
  helper_name: string,
): (data: unknown, issue: unknown) => Promise<unknown> {
  return async (data: unknown, issue: unknown) => {
    try {
      const event = get_native_request_event() as unknown as RequestEvent;
      const invalid_proxy = make_invalid_proxy();
      const result = handler({ data, invalid: invalid_proxy, issue });

      return await run_handler_effect(result, event);
    } catch (error: unknown) {
      throw normalize_remote_helper_error(error, helper_name);
    }
  };
}

function make_invalid_proxy(
  path: readonly (string | number)[] = [],
): FormInvalid {
  const invalid_at_path = (message: string) =>
    Effect.fail(
      create_form_error([{ message, path: [...path] } satisfies FormIssue]),
    );

  return new Proxy(invalid_at_path, {
    get(_target, property) {
      if (typeof property === "symbol") {
        return undefined;
      }

      return make_invalid_proxy([...path, property]);
    },
  }) as FormInvalid;
}

function is_unchecked(value: unknown): value is "unchecked" {
  return value === "unchecked";
}

function is_handler(value: unknown): value is RemoteHandler {
  return typeof value === "function";
}

/**
 * Factory for a read-only remote query function. Supports SvelteKit's
 * no-arg, `"unchecked"`, and schema-validated overloads.
 *
 * @example
 * ```ts
 * import { Query } from "svelte-effect-runtime/server";
 *
 * export const getUser = Query("unchecked", (input: { id: string }) =>
 *   Effect.gen(function* () {
 *     const event = yield* RequestEvent;
 *     return { id: input.id, path: event.url.pathname };
 *   })
 * );
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit query function.
 */
export function Query(
  validate_or_handler: unknown,
  maybe_handler?: RemoteHandler,
): ReturnType<typeof native_query> {
  try {
    if (maybe_handler) {
      return native_query(
        validate_or_handler as never,
        make_remote_wrapper(maybe_handler, "Query") as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Query('unchecked', handler) requires a handler");
    }

    return native_query(
      make_remote_wrapper(
        validate_or_handler as RemoteHandler,
        "Query",
      ) as never,
    ) as ReturnType<typeof native_query>;
  } catch (error: unknown) {
    throw normalize_remote_helper_error(error, "Query");
  }
}

/**
 * Factory for a write-oriented remote command function. Supports
 * SvelteKit's no-arg, `"unchecked"`, and schema-validated overloads.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit command function.
 */
export function Command(
  validate_or_handler: unknown,
  maybe_handler?: RemoteHandler,
): ReturnType<typeof native_command> {
  try {
    if (maybe_handler) {
      return native_command(
        validate_or_handler as never,
        make_remote_wrapper(maybe_handler, "Command") as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Command('unchecked', handler) requires a handler");
    }

    return native_command(
      make_remote_wrapper(
        validate_or_handler as RemoteHandler,
        "Command",
      ) as never,
    ) as ReturnType<typeof native_command>;
  } catch (error: unknown) {
    throw normalize_remote_helper_error(error, "Command");
  }
}

/**
 * Factory for a remote form handler. Supports SvelteKit's no-arg,
 * `"unchecked"`, and schema-validated overloads.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit form function.
 */
export function Form(
  validate_or_handler: unknown,
  maybe_handler?: RemoteFormHandler,
): ReturnType<typeof native_form> {
  try {
    if (maybe_handler) {
      return native_form(
        validate_or_handler as never,
        make_remote_form_wrapper(maybe_handler, "Form") as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Form('unchecked', handler) requires a handler");
    }

    return native_form(
      make_remote_form_wrapper(
        (({ data, invalid, issue }) =>
          (validate_or_handler as RemoteFormHandler)({
            data,
            invalid,
            issue,
          })) as RemoteFormHandler,
        "Form",
      ) as never,
    ) as unknown as ReturnType<typeof native_form>;
  } catch (error: unknown) {
    throw normalize_remote_helper_error(error, "Form");
  }
}

/**
 * Factory for a prerenderable remote function. Supports SvelteKit's
 * no-arg, `"unchecked"`, and schema-validated overloads.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler_or_options - Handler or prerender options.
 * @param maybe_options - Prerender options used with a validator.
 * @returns A SvelteKit prerender function.
 */
export function Prerender(
  validate_or_handler: unknown,
  maybe_handler_or_options?: RemoteHandler | PrerenderOptions,
  maybe_options?: PrerenderOptions,
): ReturnType<typeof native_prerender> {
  try {
    if (is_handler(maybe_handler_or_options)) {
      return native_prerender(
        validate_or_handler as never,
        make_remote_wrapper(maybe_handler_or_options, "Prerender") as never,
        maybe_options as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Prerender('unchecked', handler) requires a handler");
    }

    return native_prerender(
      make_remote_wrapper(
        validate_or_handler as RemoteHandler,
        "Prerender",
      ) as never,
      maybe_handler_or_options as never,
    ) as ReturnType<typeof native_prerender>;
  } catch (error: unknown) {
    throw normalize_remote_helper_error(error, "Prerender");
  }
}
