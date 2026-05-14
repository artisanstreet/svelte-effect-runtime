import { Effect, type Layer, ManagedRuntime, Context } from "effect";
import {
  error as svelte_error,
  invalid as svelte_invalid,
  query as native_query,
  command as native_command,
  form as native_form,
  prerender as native_prerender,
} from "$app/server";
import {
  type FormIssue,
  create_serialized_remote_failure_envelope,
} from "$/remote/shared.ts";
import {
  run_remote_effect,
  throw_form_error,
  normalize_remote_helper_error,
} from "$/remote/server.ts";

// ─── RequestEvent tag ─────────────────────────────────────────

/**
 * SvelteKit's `RequestEvent` exposed as an Effect {@link Context.Tag} so
 * remote handlers can `yield* RequestEvent` to access the raw event
 * inside their Effect programs.
 *
 * @example
 * ```ts
 * const hello = Query(function* (event) {
 *   const name = event.url.searchParams.get("name") ?? "world";
 *   return `Hello, ${name}`;
 * });
 * ```
 *
 * @since 2.0.0
 */
export const RequestEvent = Context.Reference<RequestEvent>(
  "@ser/RequestEvent",
);

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

// ─── ServerRuntime ────────────────────────────────────────────

/**
 * Builder for the server-side Effect runtime. Every remote handler runs
 * its Effect through a `ManagedRuntime`. Call `ServerRuntime.make()` to
 * configure the runtime with layers (database connections, service stubs).
 *
 * If never called, a default empty-layer runtime is created lazily on
 * the first handler invocation.
 *
 * @example
 * ```ts
 * import { ServerRuntime } from "svelte-effect-runtime/_server";
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
  ): ManagedRuntime.ManagedRuntime<R> {

    const runtime = ManagedRuntime.make(
      layer ?? (Layer.empty as unknown as Layer.Layer<R>),
    );

    current_server_runtime = runtime as ManagedRuntime.ManagedRuntime<unknown>;

    return runtime;
  }
}

let current_server_runtime: ManagedRuntime.ManagedRuntime<unknown> | undefined;

/**
 * Returns the active server runtime, lazily creating a default
 * empty-layer runtime if none has been configured.
 *
 * @since 2.0.0
 * @returns The current ManagedRuntime instance.
 */
export function get_server_runtime_or_throw(): ManagedRuntime.ManagedRuntime<unknown> {

  current_server_runtime ??= ManagedRuntime.make(Layer.empty);

  return current_server_runtime;
}

// ─── Remote function factories ────────────────────────────────

/**
 * Shape of a handler passed to a remote function factory. Accepts the
 * SvelteKit `RequestEvent` and optional input and returns an Effect or a
 * generator (which is lifted into `Effect.gen`).
 *
 * @since 2.0.0
 */
type RemoteHandler<A = unknown> = (
  event: RequestEvent,
  input: unknown,
) =>
  | Effect.Effect<A, unknown>
  | Generator<unknown, A, unknown>;

/**
 * Builds the wrapper passed to SvelteKit's native factories. Provides
 * `RequestEvent` via `Effect.provide`, runs the handler's Effect through
 * the server runtime, and maps failures into SvelteKit-compatible error
 * responses.
 */
function make_remote_wrapper(
  handler: RemoteHandler,
  helper_name: string,
): (event: RequestEvent, ...rest: unknown[]) => Promise<unknown> {

  return async (event: RequestEvent, ...rest: unknown[]) => {

    const runtime = get_server_runtime_or_throw();

    try {
      const result = handler(event, rest[0]);

      const effect: Effect.Effect<unknown, unknown> = Effect.provideService(
        result as Effect.Effect<unknown, unknown>,
        RequestEvent,
        event,
      ) as Effect.Effect<unknown, unknown>;

      return await run_remote_effect(
        effect,
        runtime,
        svelte_invalid,
        svelte_error,
      );
    } catch (err: unknown) {
      throw normalize_remote_helper_error(err, helper_name);
    }
  };
}

/**
 * Factory for a read-only remote query function. Wraps SvelteKit's
 * `query()` with Effect-aware error handling.
 *
 * @example
 * ```ts
 * import { Query } from "svelte-effect-runtime/_server";
 *
 * export const getUser = Query(function* (event, input) {
 *   const name = event.url.searchParams.get("name");
 *   return { name, id: input.id };
 * });
 * ```
 *
 * @since 2.0.0
 * @param handler - An Effect-like handler (generator function or Effect).
 * @returns A SvelteKit query function.
 */
export function Query(
  handler: RemoteHandler,
): ReturnType<typeof native_query> {

  try {
    return native_query(
      make_remote_wrapper(handler, "Query") as Parameters<typeof native_query>[0],
    );
  } catch (err: unknown) {
    throw normalize_remote_helper_error(err, "Query");
  }
}

/**
 * Factory for a write-oriented remote command function. Wraps
 * SvelteKit's `command()` with Effect-aware error handling.
 *
 * @since 2.0.0
 * @param handler - An Effect-like handler.
 * @returns A SvelteKit command function.
 */
export function Command(
  handler: RemoteHandler,
): ReturnType<typeof native_command> {

  try {
    return native_command(
      make_remote_wrapper(handler, "Command") as Parameters<typeof native_command>[0],
    );
  } catch (err: unknown) {
    throw normalize_remote_helper_error(err, "Command");
  }
}

/**
 * Factory for a remote form handler. Wraps SvelteKit's `form()` with
 * Effect-aware error handling. The handler receives the event and
 * form input.
 *
 * @since 2.0.0
 * @param handler - An Effect-like handler.
 * @returns A SvelteKit form function.
 */
export function Form(
  handler: RemoteHandler,
): ReturnType<typeof native_form> {

  try {
    return native_form(
      make_remote_wrapper(handler, "Form") as Parameters<typeof native_form>[0],
    );
  } catch (err: unknown) {
    throw normalize_remote_helper_error(err, "Form");
  }
}

/**
 * Factory for a prerenderable remote function. Wraps SvelteKit's
 * `prerender()` with Effect-aware error handling.
 *
 * @since 2.0.0
 * @param handler - An Effect-like handler.
 * @returns A SvelteKit prerender function.
 */
export function Prerender(
  handler: RemoteHandler,
): ReturnType<typeof native_prerender> {

  try {
    return native_prerender(
      make_remote_wrapper(handler, "Prerender") as Parameters<typeof native_prerender>[0],
    );
  } catch (err: unknown) {
    throw normalize_remote_helper_error(err, "Prerender");
  }
}

// ─── Effect transport ─────────────────────────────────────────

/**
 * Builds a devalue transport table from Effect schemas. Each schema is
 * registered so domain error types survive the serialisation round-trip
 * between server and client.
 *
 * @example
 * ```ts
 * import { create_effect_transport } from "svelte-effect-runtime/_server";
 * import { Schema } from "effect";
 *
 * const transport = create_effect_transport([
 *   Schema.Struct({ code: Schema.Number }),
 * ]);
 * ```
 *
 * @since 2.0.0
 * @param raw_schemas - An array of Effect schemas to register.
 * @returns A transport table array.
 */
export function create_effect_transport(
  raw_schemas: unknown[],
): Array<[string, (value: unknown) => unknown]> {

  const entries: Array<[string, (value: unknown) => unknown]> = [];

  for (const schema of raw_schemas) {
    const s = schema as {
      identifier?: string;
      annotations?: Record<string, unknown>;
    };

    const identifier: string =
      (s.annotations?.["effect/identifier"] as string) ??
      s.identifier ??
      `schema-${entries.length}`;

    entries.push([identifier, (value: unknown) => value]);
  }

  return entries;
}
