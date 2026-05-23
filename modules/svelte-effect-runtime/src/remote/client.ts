import {
  create_remote_http_error,
  create_remote_transport_error,
  create_remote_validation_error,
  is_serialized_remote_failure_envelope,
} from "$/remote/shared.ts";
import type { RemoteForm, RemoteFormInput } from "@sveltejs/kit";
import type { FormIssue, RemoteFailure } from "$/remote/shared.ts";
import { get_dispatcher } from "$/dispatcher.ts";
import { Effect } from "effect";
import { parse } from "devalue";

/**
 * Represents a pending operation counter that remote command adapters
 * use to track in-flight requests.
 *
 * @since 2.0.0
 * @internal
 */
export interface Pending {
  /** Current count of in-flight requests. */
  value: number;
}

type NativeMethod = (...args: unknown[]) => unknown;

type NativeFormRecord = Record<PropertyKey, unknown>;

/**
 * Represents the form submit handle passed into an Effect-aware enhanced
 * remote form callback.
 *
 * @example
 * ```ts
 * form.enhance(({ submit }) =>
 *   Effect.gen(function* () {
 *     yield* submit().updates();
 *   })
 * );
 * ```
 *
 * @since 2.0.0
 * @returns An Effect value with an `updates` method that remains Effect-based.
 */
export type EffectRemoteFormSubmit =
  & Effect.Effect<unknown, RemoteFailure<unknown>>
  & {
    updates: (
      ...updates: unknown[]
    ) => Effect.Effect<unknown, RemoteFailure<unknown>>;
  };

/**
 * Represents the callback payload passed to an Effect-aware remote form
 * enhancement callback.
 *
 * @example
 * ```ts
 * form.enhance(({ data, submit }) =>
 *   Effect.gen(function* () {
 *     console.log(data);
 *     yield* submit();
 *   })
 * );
 * ```
 *
 * @since 2.0.0
 * @typeParam Input - SvelteKit remote form input shape used to type the
 *   enhanced callback data.
 * @returns The callback options passed to `enhance`, with `submit` replaced
 *   by an Effect-returning submit handle.
 */
export type EffectRemoteFormEnhanceOptions<
  Input extends RemoteFormInput | void,
> =
  & Omit<
    Parameters<RemoteForm<Input, unknown>["enhance"]>[0] extends (
      options: infer Options,
    ) => unknown ? Options
      : never,
    "submit"
  >
  & {
    submit: () => EffectRemoteFormSubmit;
  };

/**
 * Represents a SvelteKit remote form whose submission, validation, and
 * enhancement hooks expose Effect-returning APIs.
 *
 * @example
 * ```ts
 * const form = create_remote_form_adapter(nativeForm, (value) => value);
 *
 * yield* form.preflight(schema).validate();
 * ```
 *
 * @since 2.0.0
 * @typeParam Input - SvelteKit remote form input shape accepted by the
 *   adapted form.
 * @typeParam Output - SvelteKit remote form output value produced by a
 *   successful submission.
 * @returns A callable remote form whose form helpers preserve Effect-returning
 *   APIs across `preflight`, `for`, `validate`, and `enhance`.
 */
export type EffectRemoteForm<Input extends RemoteFormInput | void, Output> =
  & ((input: Input) => Effect.Effect<Output, RemoteFailure<unknown>>)
  & Omit<
    RemoteForm<Input, Output>,
    "enhance" | "for" | "preflight" | "submit" | "validate"
  >
  & {
    enhance(
      callback?: (
        options: EffectRemoteFormEnhanceOptions<Input>,
      ) => void | Promise<void> | Effect.Effect<void, unknown, unknown>,
    ): ReturnType<RemoteForm<Input, Output>["enhance"]>;
    for(id: Parameters<RemoteForm<Input, Output>["for"]>[0]): Omit<
      EffectRemoteForm<Input, Output>,
      "for"
    >;
    preflight(schema: unknown): EffectRemoteForm<Input, Output>;
    submit(input: Input): Effect.Effect<Output, RemoteFailure<unknown>>;
    validate(
      options?: Parameters<RemoteForm<Input, Output>["validate"]>[0],
    ): Effect.Effect<void, RemoteFailure<unknown>>;
  };

/**
 * Decodes a raw value received over the wire into either the domain
 * failure or the original value. Enveloped values are devalue-decoded so
 * tagged domain errors survive the SvelteKit `HttpError` boundary.
 *
 * @since 2.0.0
 * @param raw - The raw value from the network or SvelteKit `HttpError`.
 * @param decode - Optional devalue decoder function.
 * @returns The decoded value or a transport error when decoding fails.
 */
function decode_remote_error(
  raw: unknown,
  decode?: (encoded: string) => unknown,
): RemoteFailure<unknown> | unknown {
  if (is_serialized_remote_failure_envelope(raw)) {
    try {
      const decoded = decode ? decode(raw.encoded) : parse(raw.encoded);

      return decoded as RemoteFailure<unknown>;
    } catch {
      return create_remote_transport_error(
        new Error("Failed to decode remote error payload"),
        raw,
      );
    }
  }

  return raw;
}

function has_method<K extends PropertyKey>(
  value: unknown,
  key: K,
): value is Record<K, NativeMethod> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<PropertyKey, unknown>)[key] === "function"
  );
}

function is_decoded_remote_failure(
  value: unknown,
): value is RemoteFailure<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value
  );
}

function is_validation_body(
  value: unknown,
): value is { issues: readonly FormIssue[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { issues?: unknown }).issues)
  );
}

function get_error_status(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;

  return typeof status === "number" ? status : undefined;
}

function get_error_body(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if ("body" in error) {
    return (error as { body?: unknown }).body;
  }

  if ("data" in error) {
    return (error as { data?: unknown }).data;
  }

  return undefined;
}

async function decode_response_failure(
  response: Response,
): Promise<RemoteFailure<unknown>> {
  const body = await response.json().catch(() => undefined);
  const decoded = decode_remote_error(body);

  if (is_decoded_remote_failure(decoded)) {
    return decoded;
  }

  if (response.status === 400 && is_validation_body(body)) {
    return create_remote_validation_error(body.issues, body, response.status);
  }

  return create_remote_http_error(response.status, body);
}

function normalize_native_error(error: unknown): RemoteFailure<unknown> {
  const body = get_error_body(error);
  const decoded = decode_remote_error(body);
  const status = get_error_status(error);

  if (is_decoded_remote_failure(decoded)) {
    return decoded;
  }

  if (status === 400 && is_validation_body(body)) {
    return create_remote_validation_error(body.issues, body, status);
  }

  if (status !== undefined) {
    return create_remote_http_error(status, body, error);
  }

  return create_remote_transport_error(error);
}

async function decode_response_or_value<Output>(
  value: unknown,
  decode_payload: (value: unknown) => unknown,
): Promise<Output> {
  if (value instanceof Response) {
    if (!value.ok) {
      throw await decode_response_failure(value);
    }

    const data = await value.json();

    return decode_payload(data) as Output;
  }

  return decode_payload(value) as Output;
}

async function resolve_query_result<Output>(
  value: unknown,
  decode_payload: (value: unknown) => unknown,
): Promise<Output> {
  if (has_method(value, "run")) {
    const result = await value.run();

    return decode_response_or_value(result, decode_payload);
  }

  const result = await Promise.resolve(value);

  return decode_response_or_value(result, decode_payload);
}

function make_effect_from_promise<Output>(
  run: () => Promise<Output>,
): Effect.Effect<Output, RemoteFailure<unknown>> {
  return Effect.tryPromise({
    try: run,
    catch: (error: unknown) => {
      if (is_decoded_remote_failure(error)) {
        return error;
      }

      return normalize_native_error(error);
    },
  }) as Effect.Effect<Output, RemoteFailure<unknown>>;
}

/**
 * Creates a remote query adapter. The returned function takes input and
 * returns an `Effect` that executes SvelteKit's native query function.
 *
 * @example
 * ```ts
 * const getUser = create_remote_query_adapter(nativeQuery, (value) => value);
 * const user = yield* getUser({ id: 1 });
 * ```
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native query function or a legacy
 *   response factory used by tests.
 * @param decode_payload - Function to decode the response payload.
 * @param _base - Deprecated transport base retained for compatibility.
 * @returns A function returning an Effect of the response.
 * @internal
 */
export function create_remote_query_adapter<Input, Output>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  _base = "",
): (input: Input) => Effect.Effect<Output, RemoteFailure<unknown>> {
  const load = has_method(native_factory, "load")
    ? native_factory.load
    : undefined;

  if (typeof native_factory !== "function" && !load) {
    throw new Error("Invalid query factory: expected a function");
  }

  return (input: Input) =>
    make_effect_from_promise(async () => {
      const result = load
        ? await load(input)
        : (native_factory as NativeMethod)(input);

      return await resolve_query_result<Output>(result, decode_payload);
    });
}

/**
 * Creates a remote command adapter. The adapter preserves the native
 * pending getter and turns each invocation into an Effect.
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native command function or a legacy
 *   response factory used by tests.
 * @param decode_payload - Function to decode the response payload.
 * @param _base - Deprecated transport base retained for compatibility.
 * @param pending - Optional pending counter for legacy response factories.
 * @returns A function returning an Effect of the response.
 * @internal
 */
export function create_remote_command_adapter<Input, Output>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  _base = "",
  pending?: Pending,
): (input: Input) => Effect.Effect<Output, RemoteFailure<unknown>> {
  const invoke = has_method(native_factory, "invoke")
    ? native_factory.invoke
    : undefined;

  if (typeof native_factory !== "function" && !invoke) {
    throw new Error("Invalid command factory: expected a function");
  }

  const count = pending ?? { value: 0 };

  const adapter = (input: Input) =>
    make_effect_from_promise(async () => {
      count.value += 1;

      try {
        const result = invoke
          ? await invoke(input)
          : await (native_factory as NativeMethod)(input);

        return await decode_response_or_value<Output>(result, decode_payload);
      } finally {
        count.value -= 1;
      }
    });

  copy_property_descriptors(native_factory, adapter);

  if (!Object.prototype.hasOwnProperty.call(adapter, "pending")) {
    Object.defineProperty(adapter, "pending", {
      get: () => count.value,
    });
  }

  return adapter;
}

/**
 * Creates a remote form adapter. The callable preserves SvelteKit's native
 * form descriptors while wrapping `validate`, `enhance`, and programmatic
 * submission in Effect-returning APIs.
 *
 * @example
 * ```ts
 * const createPost = create_remote_form_adapter(nativeForm, (value) => value);
 * yield* createPost.validate({ includeUntouched: true });
 * ```
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native form object.
 * @param decode_payload - Function to decode the response payload.
 * @param remote_base - Base URL for SvelteKit's remote endpoint.
 * @returns A callable form function whose properties mirror the native form.
 * @internal
 */
export function create_remote_form_adapter<
  Input extends RemoteFormInput | void,
  Output,
>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  remote_base = "",
): EffectRemoteForm<Input, Output> {
  const form_obj = native_factory as NativeFormRecord;

  const submit_effect = (input: Input) =>
    make_effect_from_promise(async () => {
      const can_use_remote_endpoint = remote_base.length > 0 &&
        get_remote_action_id(form_obj) !== undefined;

      if (has_method(form_obj, "submit") && !can_use_remote_endpoint) {
        const result = await form_obj.submit(input);

        return await decode_response_or_value<Output>(result, decode_payload);
      }

      return await submit_remote_form<Output>(
        form_obj,
        input,
        decode_payload,
        remote_base,
      );
    });

  const callable = ((input: Input) => submit_effect(input)) as EffectRemoteForm<
    Input,
    Output
  >;

  copy_property_descriptors(
    form_obj,
    callable,
    new Set(["submit", "validate", "enhance", "for", "preflight"]),
  );

  Object.defineProperty(callable, "submit", {
    configurable: true,
    enumerable: false,
    value: submit_effect,
  });

  if (has_method(form_obj, "validate")) {
    Object.defineProperty(callable, "validate", {
      configurable: true,
      enumerable: false,
      value: (options?: Record<string, unknown>) =>
        make_effect_from_promise(async () => {
          await form_obj.validate(options);
        }),
    });
  }

  if (has_method(form_obj, "enhance")) {
    Object.defineProperty(callable, "enhance", {
      configurable: true,
      enumerable: false,
      value: (callback?: NativeMethod) =>
        form_obj.enhance(wrap_enhance_callback(callback)),
    });
  }

  if (has_method(form_obj, "for")) {
    Object.defineProperty(callable, "for", {
      configurable: true,
      enumerable: false,
      value: (key: string | number | boolean) =>
        create_remote_form_adapter<Input, Output>(
          form_obj.for(key),
          decode_payload,
          remote_base,
        ),
    });
  }

  if (has_method(form_obj, "preflight")) {
    Object.defineProperty(callable, "preflight", {
      configurable: true,
      enumerable: false,
      value: (schema: unknown) => {
        form_obj.preflight(schema);

        return callable;
      },
    });
  }

  return callable;
}

function copy_property_descriptors(
  source: unknown,
  target: object,
  exclude: ReadonlySet<PropertyKey> = new Set(),
): void {
  if (typeof source !== "object" && typeof source !== "function") {
    return;
  }

  if (source === null) {
    return;
  }

  for (const key of Reflect.ownKeys(source)) {
    if (
      key === "length" ||
      key === "name" ||
      key === "prototype" ||
      exclude.has(key)
    ) {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(source, key);

    if (!descriptor) {
      continue;
    }

    Object.defineProperty(target, key, descriptor);
  }
}

function wrap_enhance_callback(
  callback: NativeMethod | undefined,
): NativeMethod | undefined {
  if (!callback) {
    return undefined;
  }

  return (event: unknown) => {
    const wrapped_event = wrap_submit_callback(event);
    const result = callback(wrapped_event);

    if (Effect.isEffect(result)) {
      return get_dispatcher().run(result);
    }

    return result;
  };
}

function wrap_submit_callback(event: unknown): unknown {
  if (
    typeof event !== "object" || event === null || !has_method(event, "submit")
  ) {
    return event;
  }

  const original_submit = event.submit;
  const { submit: _submit, ...descriptors } = Object.getOwnPropertyDescriptors(
    event,
  );

  void _submit;

  return Object.defineProperties({}, {
    ...descriptors,
    submit: {
      configurable: true,
      enumerable: false,
      value: () => make_submit_effect(original_submit),
    },
  });
}

function make_submit_effect(
  original_submit: NativeMethod,
): Effect.Effect<unknown, RemoteFailure<unknown>> & Record<string, unknown> {
  let updates_args: unknown[] | undefined;

  const effect = make_effect_from_promise(async () => {
    const result = original_submit();

    if (updates_args && has_method(result, "updates")) {
      return await Promise.resolve(result.updates(...updates_args));
    }

    return await Promise.resolve(result);
  }) as
    & Effect.Effect<unknown, RemoteFailure<unknown>>
    & Record<string, unknown>;

  Object.defineProperty(effect, "updates", {
    configurable: true,
    enumerable: false,
    value: (...args: unknown[]) => {
      updates_args ??= args;

      return effect;
    },
  });

  return effect;
}

async function submit_remote_form<Output>(
  form_obj: NativeFormRecord,
  input: unknown,
  decode_payload: (value: unknown) => unknown,
  remote_base: string,
): Promise<Output> {
  const action_id = get_remote_action_id(form_obj);

  if (!action_id || remote_base.length === 0) {
    throw create_remote_transport_error(
      new Error("Form has no submit method or remote endpoint"),
    );
  }

  const response = await fetch(to_remote_form_url(remote_base, action_id), {
    method: "POST",
    body: to_form_data(input),
  });

  if (!response.ok) {
    throw await decode_response_failure(response);
  }

  const envelope = await response.json();

  return decode_form_response<Output>(envelope, decode_payload);
}

function get_remote_action_id(form_obj: NativeFormRecord): string | undefined {
  const action = form_obj.action;

  if (typeof action !== "string") {
    return undefined;
  }

  const fallback = "http://localhost/";
  const href = typeof location === "undefined" ? fallback : location.href;
  const url = new URL(action, href);

  return url.searchParams.get("/remote") ??
    url.searchParams.get("remote") ??
    undefined;
}

function to_remote_form_url(remote_base: string, action_id: string): string {
  const parts = action_id.split("/");
  const head = parts.slice(0, 2).join("/");
  const tail = parts.slice(2).join("/");
  const normalized_base = remote_base.replace(/\/$/, "");

  if (tail.length === 0) {
    return `${normalized_base}/${head}`;
  }

  return `${normalized_base}/${head}/${encodeURIComponent(tail)}`;
}

function decode_form_response<Output>(
  envelope: unknown,
  decode_payload: (value: unknown) => unknown,
): Output {
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("type" in envelope)
  ) {
    throw create_remote_transport_error(
      new Error("Invalid remote form response"),
      envelope,
    );
  }

  const response = envelope as {
    type: string;
    result?: unknown;
    error?: unknown;
    status?: number;
  };

  if (response.type === "error") {
    const decoded = decode_remote_error(response.error);

    if (is_decoded_remote_failure(decoded)) {
      throw decoded;
    }

    throw create_remote_http_error(
      response.status ?? 500,
      response.error,
    );
  }

  if (response.type !== "result" || typeof response.result !== "string") {
    throw create_remote_transport_error(
      new Error("Unsupported remote form response"),
      envelope,
    );
  }

  const parsed = parse(response.result);
  const decoded = decode_payload(parsed) as {
    issues?: readonly FormIssue[];
    result?: Output;
  };

  if (decoded.issues && decoded.issues.length > 0) {
    throw create_remote_validation_error(decoded.issues, decoded, 400);
  }

  return decoded.result as Output;
}

function to_form_data(input: unknown): FormData {
  const form_data = new FormData();

  append_form_value(form_data, "", input);

  return form_data;
}

function append_form_value(
  form_data: FormData,
  path: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      append_form_value(form_data, `${path}[]`, item);
    }

    return;
  }

  if (value instanceof Blob) {
    form_data.append(path, value);

    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const child_path = path.length === 0 ? key : `${path}.${key}`;

      append_form_value(form_data, child_path, child);
    }

    return;
  }

  if (typeof value === "number") {
    form_data.append(`n:${path}`, String(value));

    return;
  }

  if (typeof value === "boolean") {
    if (value) {
      form_data.append(`b:${path}`, "on");
    }

    return;
  }

  form_data.append(path, value === null ? "" : String(value));
}
