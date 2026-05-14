import {
  Cause,
  Context,
  Effect,
  Exit,
  Option,
  Schema,
  SchemaAST,
} from "effect";

export interface EffectContextKey<Identifier, Service> {
  readonly Identifier: Identifier;
  readonly Service: Service;
  readonly key: string;
}

export interface EffectSchemaLike {
  readonly Encoded?: unknown;
  readonly Type?: unknown;
  readonly ast?: unknown;
  readonly fields?: Record<string, unknown>;
}

type EffectResume<A, E, R> = (
  effect: Effect.Effect<A, E, R>,
) => void;

type EffectCallbackFactory = <A, E = never, R = never>(
  register: (
    resume: EffectResume<A, E, R>,
    signal: AbortSignal,
  ) => void | Effect.Effect<void, never, R>,
) => Effect.Effect<A, E, R>;

type EffectAsyncFactory = <A, E = never, R = never>(
  register: (
    resume: EffectResume<A, E, R>,
  ) => void | Effect.Effect<void, never, R>,
) => Effect.Effect<A, E, R>;

type CauseLike = {
  readonly reasons?: ReadonlyArray<unknown>;
};

type FailReasonLike<ErrorType = unknown> = {
  readonly error: ErrorType;
};

type StandardSchemaFactory = (
  schema: EffectSchemaLike,
) => unknown;

export function make_context_key<Identifier, Service = Identifier>(
  key: string,
): EffectContextKey<Identifier, Service> {
  const context_namespace = Context as {
    GenericTag?: <I, S = I>(key: string) => EffectContextKey<I, S>;
    Service?: <I, S = I>(key: string) => EffectContextKey<I, S>;
  };

  if (typeof context_namespace.Service === "function") {
    return context_namespace.Service<Identifier, Service>(key);
  }

  if (typeof context_namespace.GenericTag === "function") {
    return context_namespace.GenericTag<Identifier, Service>(key);
  }

  throw new Error("No compatible Effect context key constructor was found.");
}

export function to_standard_schema_v1(
  schema: EffectSchemaLike,
): unknown {
  const schema_namespace = Schema as unknown as {
    standardSchemaV1?: StandardSchemaFactory;
    toStandardSchemaV1?: StandardSchemaFactory;
  };
  const factory = schema_namespace.toStandardSchemaV1 ??
    schema_namespace.standardSchemaV1;

  if (!factory) {
    throw new Error(
      "No compatible standard schema adapter was found in effect/Schema.",
    );
  }

  return factory(schema);
}

export function create_async_effect<A, E = never, R = never>(
  register: (
    resume: EffectResume<A, E, R>,
  ) => void | Effect.Effect<void, never, R>,
): Effect.Effect<A, E, R> {
  const effect_namespace = Effect as unknown as {
    readonly callback?: EffectCallbackFactory;
    readonly async?: EffectAsyncFactory;
  };

  if (typeof effect_namespace.callback === "function") {
    return effect_namespace.callback((resume, _signal) => register(resume));
  }

  if (typeof effect_namespace.async === "function") {
    return effect_namespace.async(register);
  }

  throw new Error("No compatible async Effect constructor was found.");
}

export function get_cause_failure<ErrorType>(
  cause: unknown,
): ErrorType | undefined {
  const cause_namespace = Cause as {
    failureOption?: (cause: unknown) => Option.Option<ErrorType>;
    findFail?: (cause: unknown) => unknown;
    isFailReason?: (reason: unknown) => reason is FailReasonLike<ErrorType>;
  };

  if (typeof cause_namespace.failureOption === "function") {
    const failure = cause_namespace.failureOption(cause);
    return Option.isSome(failure) ? failure.value : undefined;
  }

  const fail_reason = get_fail_reason_from_cause(
    cause as CauseLike,
    cause_namespace.isFailReason,
  );

  if (fail_reason) {
    return fail_reason.error as ErrorType;
  }

  if (typeof cause_namespace.findFail === "function") {
    const result = cause_namespace.findFail(cause);
    const match = extract_success_value(result);

    if (is_fail_reason_like(match)) {
      return match.error as ErrorType;
    }
  }

  return undefined;
}

export function exit_has_interrupts<A, E>(
  exit: Exit.Exit<A, E>,
): boolean {
  const exit_namespace = Exit as unknown as {
    readonly hasInterrupts?: (exit: Exit.Exit<A, E>) => boolean;
    readonly isInterrupted?: (exit: Exit.Exit<A, E>) => boolean;
  };

  if (typeof exit_namespace.hasInterrupts === "function") {
    return exit_namespace.hasInterrupts(exit);
  }

  if (typeof exit_namespace.isInterrupted === "function") {
    return exit_namespace.isInterrupted(exit);
  }

  return false;
}

export function get_effect_schema_field_names(
  schema: EffectSchemaLike,
): ReadonlyArray<string> {
  if (schema.fields && typeof schema.fields === "object") {
    return Object.keys(schema.fields);
  }

  const get_property_signatures = Reflect.get(
    SchemaAST as object,
    "getPropertySignatures",
  ) as
    | ((ast: unknown) => ReadonlyArray<{ readonly name: unknown }>)
    | undefined;

  if (schema.ast && typeof get_property_signatures === "function") {
    return get_property_signatures(schema.ast)
      .map((property_signature) => property_signature.name)
      .filter((name): name is string => typeof name === "string");
  }

  const is_objects_ast = Reflect.get(
    SchemaAST as object,
    "isObjects",
  ) as ((ast: unknown) => boolean) | undefined;

  if (
    schema.ast &&
    typeof is_objects_ast === "function" &&
    is_objects_ast(schema.ast) &&
    Array.isArray(
      (schema.ast as { readonly propertySignatures?: unknown })
        .propertySignatures,
    )
  ) {
    return (
      schema.ast as {
        readonly propertySignatures: ReadonlyArray<{ readonly name: unknown }>;
      }
    ).propertySignatures
      .map((property_signature) => property_signature.name)
      .filter((name): name is string => typeof name === "string");
  }

  return [];
}

export function to_transportable_data(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof URL ||
    value instanceof URLSearchParams ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return value;
  }

  if (value instanceof Map) {
    const normalized = new Map<unknown, unknown>();
    seen.set(value, normalized);

    for (const [key, entry] of value.entries()) {
      normalized.set(
        to_transportable_data(key, seen),
        to_transportable_data(entry, seen),
      );
    }

    return normalized;
  }

  if (value instanceof Set) {
    const normalized = new Set<unknown>();
    seen.set(value, normalized);

    for (const entry of value.values()) {
      normalized.add(to_transportable_data(entry, seen));
    }

    return normalized;
  }

  if (Array.isArray(value)) {
    const normalized: Array<unknown> = [];
    seen.set(value, normalized);

    for (const entry of value) {
      normalized.push(to_transportable_data(entry, seen));
    }

    return normalized;
  }

  const normalized: Record<string, unknown> = {};
  seen.set(value, normalized);

  const property_names = new Set<string>(Object.keys(value));

  if (value instanceof Error) {
    property_names.add("name");
    property_names.add("message");

    if ("stack" in value) {
      property_names.add("stack");
    }

    if ("cause" in value) {
      property_names.add("cause");
    }
  }

  for (const property_name of property_names) {
    const property_value = Reflect.get(value, property_name);

    if (property_value === undefined) {
      continue;
    }

    normalized[property_name] = to_transportable_data(property_value, seen);
  }

  return normalized;
}

function get_fail_reason_from_cause<ErrorType>(
  cause: CauseLike,
  is_fail_reason?: (reason: unknown) => reason is FailReasonLike<ErrorType>,
): FailReasonLike<ErrorType> | undefined {
  if (!Array.isArray(cause.reasons)) {
    return undefined;
  }

  const match = cause.reasons.find((reason) =>
    is_fail_reason ? is_fail_reason(reason) : is_fail_reason_like(reason)
  );

  return is_fail_reason_like(match)
    ? match as FailReasonLike<ErrorType>
    : undefined;
}

function extract_success_value(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  if (
    "_tag" in result &&
    (result as { readonly _tag?: unknown })._tag === "Success" &&
    "value" in result
  ) {
    return (result as { readonly value?: unknown }).value;
  }

  if (
    "_tag" in result &&
    (result as { readonly _tag?: unknown })._tag === "Right" &&
    "right" in result
  ) {
    return (result as { readonly right?: unknown }).right;
  }

  if ("value" in result) {
    return (result as { readonly value?: unknown }).value;
  }

  return undefined;
}

function is_fail_reason_like(value: unknown): value is FailReasonLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value,
  );
}
