/**
 * Public API surface for `svelte-effect-runtime`. Users configure the
 * client-side runtime with `Dispatcher.make(layer?)` and can import
 * error types for typed catch handlers.
 *
 * Everything else — the preprocessor, detection utilities, error classes,
 * generator helpers — is `@internal` and imported only by generated code
 * or the Vite plugin.
 *
 * @module
 */
export { Dispatcher, type Dispose, type PromiseOptions, type ValueOptions } from "$/dispatcher.ts";

/** Re-export error types users need for typed catch handlers. */
export type {
  FormError,
  FormIssue,
  RemoteFailure,
  RemoteHttpError,
  RemoteTransportError,
  RemoteValidationError,
} from "$/remote/shared.ts";
export {
  is_form_error,
  is_remote_http_error,
  is_remote_transport_error,
  is_remote_validation_error,
} from "$/remote/shared.ts";
