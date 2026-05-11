# Errors

The wire-level failure types exposed by the runtime, plus the
form-validation error helpers.

## `RemoteFailure<Error>`

The error channel of every Effect returned by a remote call. A union of
your own tagged error (placed directly on the channel — no wrapper) and
SvelteKit's transport-level failures:

```ts
type RemoteFailure<Error = unknown> =
  | Error                      // your tagged domain error, surfaced as-is
  | RemoteValidationError      // schema or form validation rejected the payload
  | RemoteHttpError            // HTTP response was not a remote envelope
  | RemoteTransportError;      // network or decode failure (no HTTP status)
```

Recovering a typed domain error:

```ts
yield* create_post.submit(data).pipe(
  Effect.catchTag("YourTag", (err) => Effect.succeed(/* ... */))
);
```

## Variant shapes

```ts
interface RemoteValidationError {
  readonly _tag: "RemoteValidationError";
  readonly body?: unknown;
  readonly issues: ReadonlyArray<FormIssue>;
  readonly status: number;        // defaults to 400
}

interface RemoteHttpError {
  readonly _tag: "RemoteHttpError";
  readonly body?: unknown;
  readonly cause: unknown;
  readonly status: number;
}

interface RemoteTransportError {
  readonly _tag: "RemoteTransportError";
  readonly body?: unknown;
  readonly cause: unknown;
}
```

## `FormIssue` / `FormError`

Issued by the `invalid` proxy inside `Form` handlers:

```ts
interface FormIssue {
  readonly message: string;
  readonly path: ReadonlyArray<string | number>;
}

interface FormError<SchemaType = unknown> {
  readonly _tag: "FormError";
  readonly issues: ReadonlyArray<FormIssue>;
  readonly _schema?: SchemaType;
}
```

Yield `invalid.<field>(message)` or `invalid.form(message)` inside a
`Form` handler to produce one. The runtime serialises the issues onto
the form's reactive `fields.X.issues()` accessor on the client.

## Deprecated: `RemoteDomainError`

```ts
/** @deprecated */
interface RemoteDomainError<Error = unknown> {
  readonly _tag: "RemoteDomainError";
  readonly cause: Error;
  readonly status: number;
}
```

Earlier versions wrapped server-side domain errors in
`RemoteDomainError`. As of the current runtime, your tagged error is
placed **directly** on the Effect error channel, so
`Effect.catchTag("YourTag", ...)` works without unwrapping. The
interface is kept only for backwards compatibility with code that
pattern-matched on `_tag === "RemoteDomainError"`. Do not introduce new
references to it.
