import {
  error as svelte_error,
  redirect as svelte_redirect,
} from "@sveltejs/kit";
import { Effect } from "effect";

const error_status_codes = {
  ProxyAuthenticationRequired: 407,
  RequestHeaderFieldsTooLarge: 431,
  UnavailableForLegalReasons: 451,
  NetworkAuthenticationRequired: 511,
  HttpVersionNotSupported: 505,
  UnprocessableContent: 422,
  UnprocessableEntity: 422,
  InternalServerError: 500,
  FailedDependency: 424,
  PreconditionRequired: 428,
  ServiceUnavailable: 503,
  MisdirectedRequest: 421,
  InsufficientStorage: 507,
  VariantAlsoNegotiates: 506,
  PreconditionFailed: 412,
  MethodNotAllowed: 405,
  GatewayTimeout: 504,
  PaymentRequired: 402,
  UpgradeRequired: 426,
  TooManyRequests: 429,
  LengthRequired: 411,
  NotAcceptable: 406,
  RequestTimeout: 408,
  ContentTooLarge: 413,
  PayloadTooLarge: 413,
  UriTooLong: 414,
  UnsupportedMediaType: 415,
  RangeNotSatisfiable: 416,
  ExpectationFailed: 417,
  ImATeapot: 418,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  Gone: 410,
  Locked: 423,
  TooEarly: 425,
  NotImplemented: 501,
  BadGateway: 502,
  LoopDetected: 508,
  NotExtended: 510,
} as const;

const redirect_status_codes = {
  MovedPermanently: 301,
  TemporaryRedirect: 307,
  PermanentRedirect: 308,
  MultipleChoices: 300,
  NotModified: 304,
  SwitchProxy: 306,
  SeeOther: 303,
  UseProxy: 305,
  Found: 302,
} as const;

type AppErrorStatus = App.Error extends { readonly status?: infer Status }
  ? Status
  : number;

type SvelteError = (
  status: number,
  body?: ErrorBody,
  properties?: ErrorProperties,
) => never;

type SvelteRedirect = (
  status: number,
  location: string | URL,
  options?: RedirectOptions,
) => never;

/**
 * Named HTTP status accepted by the {@link Error} helper.
 *
 * @example
 * ```ts
 * const status: ErrorStatusName = "NotFound";
 * ```
 *
 * @since 2.3.0
 */
export type ErrorStatusName = keyof typeof error_status_codes;

/**
 * Numeric or named HTTP status accepted by the {@link Error} helper.
 *
 * @example
 * ```ts
 * const status: ErrorStatus = "InternalServerError";
 * ```
 *
 * @since 2.3.0
 */
export type ErrorStatus = ErrorStatusName | number;

/**
 * Error body accepted by the {@link Error} helper.
 *
 * @example
 * ```ts
 * const body: ErrorBody = { message: "Post not found" };
 * ```
 *
 * @since 3.4.3
 */
export type ErrorBody =
  | (Omit<App.Error, "status"> & { readonly status?: AppErrorStatus })
  | string
  | undefined;

/**
 * Extra SvelteKit app error properties accepted by the {@link Error} helper
 * when using the SvelteKit 3 string-body overload.
 *
 * @example
 * ```ts
 * const properties: ErrorProperties = { code: "POST_NOT_FOUND" };
 * ```
 *
 * @since 3.4.3
 */
export type ErrorProperties = Omit<App.Error, "status" | "message">;

/**
 * Named HTTP status accepted by the {@link Redirect} helper.
 *
 * @example
 * ```ts
 * const status: RedirectStatusName = "TemporaryRedirect";
 * ```
 *
 * @since 2.3.0
 */
export type RedirectStatusName = keyof typeof redirect_status_codes;

/**
 * Numeric or named HTTP status accepted by the {@link Redirect} helper.
 *
 * @example
 * ```ts
 * const status: RedirectStatus = "SeeOther";
 * ```
 *
 * @since 2.3.0
 */
export type RedirectStatus = RedirectStatusName | number;

/**
 * Options accepted by the {@link Redirect} helper.
 *
 * @example
 * ```ts
 * const options: RedirectOptions = { external: true };
 * ```
 *
 * @since 3.4.3
 */
export type RedirectOptions = {
  readonly external?: boolean | string[];
};

/**
 * Callable shape for the exported {@link Error} helper.
 *
 * @example
 * ```ts
 * const fail_not_found: ErrorEffectFactory = Error;
 * ```
 *
 * @since 2.3.0
 */
export interface ErrorEffectFactory {
  /**
   * Creates an Effect that throws SvelteKit's HTTP error control-flow value.
   *
   * @example
   * ```ts
   * return yield* Error("NotFound", "Post not found");
   * ```
   *
   * @since 2.3.0
   * @param status - Numeric HTTP status or PascalCase status name to pass to
   *   SvelteKit's `error` helper.
   * @param body - Optional SvelteKit error body or message forwarded unchanged
   *   to SvelteKit.
   * @returns An Effect that never succeeds because SvelteKit takes over request
   *   control flow.
   */
  (
    status: ErrorStatus,
    body?: ErrorBody,
  ): Effect.Effect<never, never, never>;

  /**
   * Creates an Effect that throws SvelteKit's HTTP error control-flow value
   * using the SvelteKit 3 string-body overload with extra properties.
   *
   * @example
   * ```ts
   * return yield* Error("NotFound", "Post not found", {
   *   code: "POST_NOT_FOUND",
   * });
   * ```
   *
   * @since 3.4.3
   * @param status - Numeric HTTP status or PascalCase status name to pass to
   *   SvelteKit's `error` helper.
   * @param body - Error message forwarded to SvelteKit.
   * @param properties - Additional app error properties forwarded to
   *   SvelteKit.
   * @returns An Effect that never succeeds because SvelteKit takes over request
   *   control flow.
   */
  (
    status: ErrorStatus,
    body: string,
    properties: ErrorProperties,
  ): Effect.Effect<never, never, never>;
}

/**
 * Callable shape for the exported {@link Redirect} helper.
 *
 * @example
 * ```ts
 * const redirect_after_save: RedirectEffectFactory = Redirect;
 * ```
 *
 * @since 2.3.0
 */
export interface RedirectEffectFactory {
  /**
   * Creates an Effect that throws SvelteKit's redirect control-flow value.
   *
   * @example
   * ```ts
   * return yield* Redirect("SeeOther", "/posts");
   * ```
   *
   * @since 2.3.0
   * @param status - Numeric redirect status or PascalCase status name to pass
   *   to SvelteKit's `redirect` helper.
   * @param location - Target URL forwarded unchanged to SvelteKit.
   * @param options - Optional SvelteKit redirect options. In SvelteKit 3, pass
   *   `{ external: true }` or an allowlist to redirect to external URLs.
   * @returns An Effect that never succeeds because SvelteKit takes over request
   *   control flow.
   */
  (
    status: RedirectStatus,
    location: string | URL,
    options?: RedirectOptions,
  ): Effect.Effect<never, never, never>;
}

/**
 * Creates an Effect that raises SvelteKit's HTTP error control flow.
 *
 * @example
 * ```ts
 * return yield* Error("NotFound", "Post not found");
 * ```
 *
 * @since 2.3.0
 * @param status - Numeric HTTP status or PascalCase status name to pass to
 *   SvelteKit's `error` helper.
 * @param body - Optional SvelteKit error body or message forwarded unchanged
 *   to SvelteKit.
 * @param properties - Optional SvelteKit 3 app error properties forwarded when
 *   using a string error message.
 * @returns An Effect that never succeeds because SvelteKit takes over request
 *   control flow.
 */
export const Error: ErrorEffectFactory = ((
  status: ErrorStatus,
  body?: ErrorBody,
  properties?: ErrorProperties,
) => {
  const resolved_status = resolve_error_status(status);
  const error = svelte_error as SvelteError;

  return Effect.sync((): never => {
    if (properties === undefined) {
      return error(resolved_status, body);
    }

    return error(resolved_status, body, properties);
  });
}) as ErrorEffectFactory;

/**
 * Creates an Effect that raises SvelteKit's redirect control flow.
 *
 * @example
 * ```ts
 * return yield* Redirect("SeeOther", "/posts");
 * ```
 *
 * @since 2.3.0
 * @param status - Numeric redirect status or PascalCase status name to pass to
 *   SvelteKit's `redirect` helper.
 * @param location - Target URL forwarded unchanged to SvelteKit.
 * @param options - Optional SvelteKit redirect options. In SvelteKit 3, pass
 *   `{ external: true }` or an allowlist to redirect to external URLs.
 * @returns An Effect that never succeeds because SvelteKit takes over request
 *   control flow.
 */
export const Redirect: RedirectEffectFactory = ((
  status: RedirectStatus,
  location: string | URL,
  options?: RedirectOptions,
) => {
  const resolved_status = resolve_redirect_status(status);
  const redirect = svelte_redirect as SvelteRedirect;

  return Effect.sync((): never => redirect(resolved_status, location, options));
}) as RedirectEffectFactory;

function resolve_error_status(status: ErrorStatus): number {
  if (typeof status === "number") {
    return status;
  }

  return error_status_codes[status];
}

function resolve_redirect_status(status: RedirectStatus): number {
  if (typeof status === "number") {
    return status;
  }

  return redirect_status_codes[status];
}
