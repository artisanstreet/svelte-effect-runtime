import { test } from "vitest";
import { assert_equals } from "./helpers/assert.ts";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Type-error fixtures intentionally keep TypeScript's directive comment syntax
 * inside embedded source strings because the compiler only recognizes that
 * exact marker.
 */
test("remote form preflight keeps enhance callback Effect-aware", async () => {
	await assert_type_checks(
		"preflight-enhance.ts",
		`
import { Effect, Schema } from "effect";
import { create_remote_form_adapter } from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/client.ts";
import type { RemoteFormInput } from "@sveltejs/kit";

declare const schema: {
  "~standard": {
    validate(value: unknown): { value: RemoteFormInput };
    vendor: "test";
    version: 1;
  };
};

const form = create_remote_form_adapter<RemoteFormInput, void>({}, (value) => value);
const returning_form = create_remote_form_adapter<
  RemoteFormInput,
  { ok: boolean }
>({}, (value) => value);

form.preflight(schema).enhance(() => Effect.void);
form.preflight(Schema.Struct({ name: Schema.String })).enhance(() => Effect.void);
form.preflight(schema).enhance(({ submit }) => submit());
form.preflight(schema).enhance(({ submit }) => submit().updates());
form.preflight(schema).enhance(({ submit }) =>
  Effect.gen(function* () {
    yield* submit().updates();
  })
);
returning_form.preflight(schema).enhance(({ submit }) => submit());
returning_form.preflight(schema).enhance(({ submit }) => submit().updates());
`,
	);
});

test("remote form preflight keeps validate Effect-yieldable", async () => {
	await assert_type_checks(
		"preflight-validate.ts",
		`
import { Effect, Schema } from "effect";
import { create_remote_form_adapter } from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/client.ts";
import type { RemoteFormInput } from "@sveltejs/kit";

declare const schema: {
  "~standard": {
    validate(value: unknown): { value: RemoteFormInput };
    vendor: "test";
    version: 1;
  };
};

const form = create_remote_form_adapter<RemoteFormInput, void>({}, (value) => value);

Effect.gen(function* () {
  yield* form.preflight(schema).validate();
  yield* form.preflight(Schema.Struct({ name: Schema.String })).validate();
  yield* form.validate({ all: true, preflightOnly: true });
  yield* form.validate({ includeUntouched: true, preflightOnly: true });
});
`,
	);
});

test("remote form enhance submit keeps form result types", async () => {
	await assert_type_checks(
		"enhance-submit-types.ts",
		`
import { Cause, Effect } from "effect";
import { create_remote_form_adapter } from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/client.ts";
import type { RemoteFailure } from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/shared.ts";
import type { RemoteFormInput } from "@sveltejs/kit";

const form = create_remote_form_adapter<RemoteFormInput, { id: string }>(
  {},
  (value) => value,
);

form.enhance(({ result, submit }) =>
  Effect.gen(function* () {
    const matched = yield* submit().pipe(
      Effect.matchCause({
        onSuccess: (value) => {
          const success: { id: string } | undefined = value;

          return success;
        },
        onFailure: (cause) => {
          const failure_cause: Cause.Cause<RemoteFailure<never>> = cause;

          return false;
        },
      }),
    );

    const current_result: { id: string } | undefined = result;

    void current_result;
    void matched;
  })
);
`,
	);
});

test("remote client adapters keep structured remote failure types", async () => {
	await assert_type_checks(
		"remote-failure-types.ts",
		`
import { Cause, Effect } from "effect";
import {
  create_remote_form_adapter,
  create_remote_query_adapter,
} from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/client.ts";
import type { RemoteFailure } from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/shared.ts";

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2) ? true : false;
type Assert<Type extends true> = Type;

const form = create_remote_form_adapter<{ title: string }, { id: string }>(
  {},
  (value) => value,
);
const query = create_remote_query_adapter<void, { id: string }>(
  () => Promise.resolve({ id: "one" }),
  (value) => value,
);

const form_submit = form.submit({ title: "draft" });
type FormSubmit = Assert<
  Equal<typeof form_submit, Effect.Effect<{ id: string }, RemoteFailure<never>>>
>;

form.submit({ title: "draft" }).pipe(
  Effect.matchCause({
    onFailure: (cause) => {
      const typed_cause: Cause.Cause<RemoteFailure<never>> = cause;

      return typed_cause;
    },
    onSuccess: (value) => value.id,
  }),
);

query().pipe(
  Effect.catchTag("RemoteHttpError", (failure) =>
    Effect.succeed(failure.status)
  ),
);
`,
	);
});

test("remote form updates accepts Effect query wrappers", async () => {
	await assert_type_checks(
		"remote-updates-query-wrapper.ts",
		`
import { Effect } from "effect";
import {
  create_remote_form_adapter,
  create_remote_live_query_adapter,
  create_remote_query_adapter,
} from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/client.ts";

const posts = create_remote_query_adapter<void, string[]>(
  () => Promise.resolve(["one"]),
  (value) => value,
);

const clock = create_remote_live_query_adapter<void, number>(
  () => ({
    connected: true,
    current: 1,
    done: false,
    error: undefined,
    loading: false,
    ready: true,
    reconnect: () => Promise.resolve(),
    [Symbol.asyncIterator]: async function* () {
      yield 1;
    },
  }),
  (value) => value,
);

const form = create_remote_form_adapter<{ title: string }, { id: string }>(
  {},
  (value) => value,
);

const post_result = posts();
const clock_result = clock();

form.enhance(({ submit }) =>
  Effect.gen(function* () {
    yield* submit().updates(posts);
    yield* submit().updates(clock);
  })
);

void post_result;
void clock_result;
`,
	);
});

test("remote form types reject invalid preflight and command updates", async () => {
	await assert_type_checks(
		"remote-form-negative-boundaries.ts",
		`
import { Effect, Schema } from "effect";
import {
  create_remote_command_adapter,
  create_remote_form_adapter,
  create_remote_query_adapter,
} from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/client.ts";
import type { RemoteFormInput } from "@sveltejs/kit";

declare const schema: {
  "~standard": {
    validate(value: unknown): { value: RemoteFormInput };
    vendor: "test";
    version: 1;
  };
};

const form = create_remote_form_adapter<RemoteFormInput | undefined, { id: string }>(
  {},
  (value) => value,
);
const posts = create_remote_query_adapter<void, string[]>(
  () => Promise.resolve(["one"]),
  (value) => value as string[],
);
const command = create_remote_command_adapter<void, string>(
  () => Promise.resolve("done"),
  (value) => value,
);

form();
form.submit();
form.preflight(schema);
form.preflight(Schema.Struct({ name: Schema.String }));
// @ts-expect-error preflight expects a Standard Schema or Effect Schema
form.preflight(123);

form.enhance(({ submit }) =>
  Effect.gen(function* () {
    yield* submit().updates(posts);
    // @ts-expect-error command adapters are not query update targets
    yield* submit().updates(command);
  })
);
`,
	);
});

test("remote query adapter infers decoder output", async () => {
	await assert_type_checks(
		"remote-query-adapter-inference.ts",
		`
import { Effect } from "effect";
import { create_remote_query_adapter } from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/client.ts";

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2) ? true : false;
type Assert<Type extends true> = Type;

const get_post = create_remote_query_adapter(
  (input: { id: string }) => Promise.resolve({ id: input.id }),
  (value): { id: string } => value as { id: string },
);

const post = get_post({ id: "one" });
type Post = Assert<Equal<Effect.Success<typeof post>, { id: string }>>;

// @ts-expect-error input shape is inferred from the native query
get_post({ slug: "one" });
`,
	);
});

test("markup value helper infers yielded value types", async () => {
	await assert_type_checks(
		"markup-value-helper-inference.ts",
		`
import { Effect } from "effect";
import { value } from "__RUNTIME__/modules/svelte-effect-runtime/src/markup/value.ts";

const loaded = value("count", [], 0, function* () {
  return yield* Effect.succeed(42);
});
const count: number = loaded;

void count;
`,
	);
});

test("server type exports include factory helper types", async () => {
	await assert_type_checks(
		"server-type-exports.ts",
		`
import type {
  CommandFactory,
  FormFactory,
  PrerenderFactory,
  QueryBatchFactory,
  QueryFactory,
  QueryLiveFactory,
  RemoteLiveHandler,
  SchemaEncodedInput,
  ServerRuntimeFactory,
} from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";

type Exports = [
  CommandFactory,
  FormFactory,
  PrerenderFactory,
  QueryBatchFactory,
  QueryFactory,
  QueryLiveFactory,
  RemoteLiveHandler,
  SchemaEncodedInput<never>,
  ServerRuntimeFactory,
];

const exports_tuple: Exports | undefined = undefined;

void exports_tuple;
`,
	);
});

test("server schema remotes preserve encoded input and domain errors", async () => {
	await assert_type_checks(
		"server-schema-remote-types.ts",
		`
import { Effect, Schema } from "effect";
import { Command, Form, Prerender, Query } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2) ? true : false;
type Assert<Type extends true> = Type;

class DomainError {
  readonly _tag = "DomainError";
}

const ReadNumber = Query(Schema.NumberFromString, (value) =>
  Effect.gen(function* () {
    const decoded: number = value;

    yield* Effect.fail(new DomainError());

    return decoded;
  })
);

const BatchNumber = Query.batch(Schema.NumberFromString, (values) =>
  Effect.succeed((value, index) => {
    const decoded: number = value;
    const known: boolean = values.includes(value);

    return { decoded, index, known };
  })
);

const WatchNumber = Query.live(Schema.NumberFromString, (value) =>
  Effect.succeed([value])
);

const SaveNumber = Command(Schema.NumberFromString, (value) =>
  Effect.gen(function* () {
    const decoded: number = value;

    yield* Effect.fail(new DomainError());

    return decoded;
  })
);

const PreloadNumber = Prerender(Schema.NumberFromString, (value) =>
  Effect.gen(function* () {
    const decoded: number = value;

    yield* Effect.fail(new DomainError());

    return decoded;
  })
);

const SignIn = Form(
  Schema.Struct({
    email: Schema.NonEmptyString,
  }),
  ({ data, invalid }) =>
    Effect.gen(function* () {
      const email: string = data.email;

      yield* invalid.email("Required");
      // @ts-expect-error unknown form fields are rejected
      yield* invalid.missing("Missing");
      // @ts-expect-error scalar form fields do not have nested invalid paths
      yield* invalid.email.deep("Deep");

      return { email };
    }),
);

type ReadNumberParameters = Assert<Equal<Parameters<typeof ReadNumber>, [input: string]>>;
type BatchNumberParameters = Assert<Equal<Parameters<typeof BatchNumber>, [input: string]>>;
type WatchNumberParameters = Assert<Equal<Parameters<typeof WatchNumber>, [input: string]>>;
type SaveNumberParameters = Assert<Equal<Parameters<typeof SaveNumber>, [input: string]>>;
type PreloadNumberParameters = Assert<Equal<Parameters<typeof PreloadNumber>, [input: string]>>;
type SignInParameters = Assert<Equal<Parameters<typeof SignIn>, [input: { readonly email: string }]>>;
type ReadNumberError = Assert<Equal<Extract<Effect.Error<ReturnType<typeof ReadNumber>>, DomainError>, DomainError>>;
type SaveNumberError = Assert<Equal<Extract<Effect.Error<ReturnType<typeof SaveNumber>>, DomainError>, DomainError>>;
type PreloadNumberError = Assert<Equal<Extract<Effect.Error<ReturnType<typeof PreloadNumber>>, DomainError>, DomainError>>;

ReadNumber("1");
BatchNumber("1");
WatchNumber("1");
SaveNumber("1");
PreloadNumber("1");
SignIn({ email: "hi@example.com" });

// @ts-expect-error schema call input uses the encoded type
ReadNumber(1);
`,
	);
});

test("server remote helpers stay Effect-yieldable in markup helpers", async () => {
	await assert_type_checks(
		"server-remote-markup.ts",
		`
import { Effect, Schema, Stream } from "effect";
import { Command, Form, Query } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
import type {
  EffectRemoteLiveQueryResource,
  EffectRemoteLiveSource,
} from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
import { promise } from "__RUNTIME__/modules/svelte-effect-runtime/src/markup/promise.ts";
import { run } from "__RUNTIME__/modules/svelte-effect-runtime/src/markup/run.ts";
import { Dispatcher, Code } from "__RUNTIME__/modules/svelte-effect-runtime/src/generators.ts";

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2) ? true : false;
type Assert<Type extends true> = Type;

const posts = [{
  id: "one",
  name: "post",
  likes: 1,
}];

const GetPosts = Query(Effect.gen(function* () {
  return posts;
}));
const GetPostSummary = Query.batch(Schema.String, (ids) =>
  Effect.succeed((id, index) => ({
    id,
    index,
    known: ids.some((candidate) => candidate === id),
  }))
);
const GetClock = Query.live("unchecked", (_key: string) =>
  Stream.make(1, 2, 3)
);
const GetNativeClock = Query.live(async function* () {
  yield "tick";
});
const live_source: EffectRemoteLiveSource<number> = Stream.make(1);

const UpvotePost = Command(Schema.String, (id) =>
  Effect.gen(function* () {
    yield* GetPosts().refresh();

    return id.length;
  })
);

const SignIn = Form(
  Schema.Struct({
    email: Schema.NonEmptyString,
    password: Schema.NonEmptyString,
  }),
  ({ data, invalid }) =>
    Effect.gen(function* () {
      const email: string = data.email;
      const password: string = data.password;

      if (password.length === 0) {
        return yield* invalid.password("Password is required");
      }

      return { email };
    }),
);

const UpdateQuantity = Form(
  Schema.Struct({
    quantity: Schema.NumberFromString,
  }),
  ({ data }) =>
    Effect.gen(function* () {
      const quantity: number = data.quantity;

      return { quantity };
    }),
);

const OptionalPost = Form(
  Schema.Struct({
    title: Schema.NonEmptyString,
    summary: Schema.optional(Schema.String),
  }),
  ({ data }) =>
    Effect.gen(function* () {
      const title: string = data.title;
      const summary: string | undefined = data.summary;

      return { title, summary };
    }),
);

const SignOut = Form(Effect.succeed({ signedOut: true }));

type GetPostsParameters = Parameters<typeof GetPosts>;
type GetPostSummaryParameters = Parameters<typeof GetPostSummary>;
type GetClockParameters = Parameters<typeof GetClock>;
type GetNativeClockParameters = Parameters<typeof GetNativeClock>;
type UpvotePostParameters = Parameters<typeof UpvotePost>;
type SignInParameters = Parameters<typeof SignIn>;
type UpdateQuantityParameters = Parameters<typeof UpdateQuantity>;
type OptionalPostParameters = Parameters<typeof OptionalPost>;
type SignInInput = SignInParameters[0];
type UpdateQuantityInput = UpdateQuantityParameters[0];
type OptionalPostInput = OptionalPostParameters[0];
type GetPostsHasNoInputParameter = Assert<Equal<GetPostsParameters, []>>;
type GetPostSummaryRequiresInput = Assert<
  Equal<GetPostSummaryParameters, [input: string]>
>;
type GetClockRequiresInput = Assert<Equal<GetClockParameters, [input: string]>>;
type GetNativeClockHasNoInput = Assert<Equal<GetNativeClockParameters, []>>;
type UpvotePostStillRequiresInput = Assert<
  Equal<UpvotePostParameters, [input: string]>
>;
type SignInKeepsEmailField = Assert<Equal<SignInInput["email"], string>>;
type SignInKeepsPasswordField = Assert<
  Equal<SignInInput["password"], string>
>;
type UpdateQuantityAcceptsEncodedFormInput = Assert<
  Equal<UpdateQuantityInput["quantity"], string>
>;
type OptionalPostKeepsTitleField = Assert<
  Equal<OptionalPostInput["title"], string>
>;
type OptionalPostKeepsOptionalSummaryField = Assert<
  Equal<OptionalPostInput["summary"], string | undefined>
>;

async function check_generated_markup_helpers() {
  const posts_query = GetPosts();
  const summary_query = GetPostSummary("one");
  const clock_query_effect = GetClock("main");
  const refresh_effect: Effect.Effect<void, unknown, never> =
    posts_query.refresh();
  const sign_out_effect = SignOut();

  posts_query.set(posts);
  const release_override = posts_query.withOverride((current) => current);

  release_override();
  await Effect.runPromise(refresh_effect);
  await Effect.runPromise(summary_query.refresh());
  const sign_out_result = await Effect.runPromise(sign_out_effect);
  const summary = await Effect.runPromise(summary_query);
  const clock_query = await Effect.runPromise(clock_query_effect);
  const native_clock_query = await Effect.runPromise(GetNativeClock());
  const reconnect_effect: Effect.Effect<void, unknown, never> =
    clock_query.reconnect();
  const native_reconnect_effect: Effect.Effect<void, unknown, never> =
    native_clock_query.reconnect();
  const signed_out: boolean = sign_out_result.signedOut;
  const clock_resource: EffectRemoteLiveQueryResource<number> = clock_query;
  const connected: boolean = clock_query.connected;
  const done: boolean = clock_query.done;
  const summary_id: string = summary.id;
  const summary_index: number = summary.index;
  const summary_known: boolean = summary.known;

  await Effect.runPromise(reconnect_effect);
  await Effect.runPromise(native_reconnect_effect);
  const optional_title: string | undefined = OptionalPost.fields.title.value();
  const optional_summary: string | undefined =
    OptionalPost.fields.summary.value();

  for await (const value of clock_query) {
    const streamed_value: number = value;

    break;
  }

  for await (const value of native_clock_query) {
    const streamed_value: string = value;

    break;
  }

  const loaded = await promise("posts", [], function* () {
    return yield* GetPosts();
  });

  const first = loaded[0];
  const id: string = first.id;
  const likes: number = first.likes;
  const emitted = await Dispatcher.emit({
    type: Code.Markup.Promise,
    id: "posts",
    deps: [],
    fn: function* () {
      return yield* GetPosts();
    },
  });
  const emitted_id: string = emitted[0].id;
  const emitted_value = Dispatcher.emit({
    type: Code.Markup.Value,
    id: "posts-value",
    deps: [],
    fallback: posts,
    fn: function* () {
      return yield* GetPosts();
    },
  });
  const emitted_likes: number = emitted_value[0].likes;

  await run(function* () {
    const count = yield* UpvotePost(id);
    const next_likes: number = likes + count;

    return next_likes;
  });

  const emitted_count: number = await Dispatcher.emit({
    type: Code.Markup.Run,
    fn: function* () {
      return yield* UpvotePost(id);
    },
  });

  void connected;
  void done;
  void clock_resource;
  void summary_id;
  void summary_index;
  void summary_known;
  void optional_title;
  void optional_summary;
  void live_source;
  void emitted_id;
  void emitted_likes;
  void emitted_count;
}

void check_generated_markup_helpers;
`,
	);
});

test("server remote helpers preserve domain error and Standard Schema types", async () => {
	await assert_type_checks(
		"server-remote-domain-types.ts",
		`
import { Effect, Schema, Stream } from "effect";
import { Command, Form, Prerender, Query } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
import type { FormInvalid } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
import type { RemoteFailure } from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/shared.ts";
import { value } from "__RUNTIME__/modules/svelte-effect-runtime/src/markup/value.ts";

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2) ? true : false;
type Assert<Type extends true> = Type;
type ErrorOf<Type> = Type extends Effect.Effect<unknown, infer Error, unknown>
  ? Error
  : never;

type DomainError = {
  readonly _tag: "DomainError";
  readonly message: string;
};

const domain_error: DomainError = {
  _tag: "DomainError",
  message: "nope",
};

const standard_string = {
  "~standard": {
    types: undefined as unknown as {
      input: string;
      output: string;
    },
    validate(input: unknown) {
      return { value: String(input) };
    },
  },
};

const standard_form = {
  "~standard": {
    types: undefined as unknown as {
      input: {
        name: string;
      };
      output: {
        name: string;
      };
    },
    validate(input: unknown) {
      return { value: input as { name: string } };
    },
  },
};

function maybe_fail(value: string) {
  return Effect.gen(function* () {
    if (value.length === 0) {
      yield* Effect.fail(domain_error);
    }

    return value;
  });
}

declare const invalid: FormInvalid;

const QueryBySchema = Query(standard_string, (value) => maybe_fail(value));
const BatchBySchema = Query.batch(standard_string, (values) =>
  Effect.succeed((value, index) => value.length + values.length + index)
);
const LiveBySchema = Query.live(standard_string, (value) =>
  Stream.make(value)
);
const CommandBySchema = Command(standard_string, (value) => maybe_fail(value));
const FormBySchema = Form(standard_form, ({ data }) => maybe_fail(data.name));
const PrerenderBySchema = Prerender(standard_string, (value) =>
  maybe_fail(value)
);
const PrerenderWithoutInput = Prerender(() => Effect.succeed("ready"));
const generated_value: number = value("count", [], 0, function* () {
  return yield* Effect.succeed(1);
});

type QueryParameters = Parameters<typeof QueryBySchema>;
type BatchParameters = Parameters<typeof BatchBySchema>;
type LiveParameters = Parameters<typeof LiveBySchema>;
type CommandParameters = Parameters<typeof CommandBySchema>;
type FormParameters = Parameters<typeof FormBySchema>;
type PrerenderParameters = Parameters<typeof PrerenderBySchema>;
type QueryError = ErrorOf<ReturnType<typeof QueryBySchema>>;
type CommandError = ErrorOf<ReturnType<typeof CommandBySchema>>;
type FormError = ErrorOf<ReturnType<typeof FormBySchema>>;
type PrerenderError = ErrorOf<ReturnType<typeof PrerenderBySchema>>;
type QueryHasDomainError = Assert<
  Equal<Extract<QueryError, DomainError>, DomainError>
>;
type CommandHasDomainError = Assert<
  Equal<Extract<CommandError, DomainError>, DomainError>
>;
type FormHasDomainError = Assert<
  Equal<Extract<FormError, DomainError>, DomainError>
>;
type PrerenderHasDomainError = Assert<
  Equal<Extract<PrerenderError, DomainError>, DomainError>
>;
type QueryTakesStandardInput = Assert<Equal<QueryParameters, [input: string]>>;
type BatchTakesStandardInput = Assert<Equal<BatchParameters, [input: string]>>;
type LiveTakesStandardInput = Assert<Equal<LiveParameters, [input: string]>>;
type CommandTakesStandardInput = Assert<
  Equal<CommandParameters, [input: string]>
>;
type FormTakesStandardInput = Assert<
  Equal<FormParameters, [input: { name: string }]>
>;
type PrerenderTakesStandardInput = Assert<
  Equal<PrerenderParameters, [input: string]>
>;

const query_effect: Effect.Effect<
  string,
  RemoteFailure<DomainError>,
  unknown
> = QueryBySchema("id");
const prerender_effect: Effect.Effect<
  string,
  RemoteFailure<DomainError>,
  unknown
> = PrerenderBySchema("id");
const prerender_without_input_effect: Effect.Effect<
  string,
  RemoteFailure<never>,
  unknown
> = PrerenderWithoutInput();
const invalid_name = invalid.name("Name is required");
const invalid_length = invalid.length("Length is required");

void Query.batch;
void Schema.String;
void query_effect;
void prerender_effect;
void prerender_without_input_effect;
void invalid_name;
void invalid_length;
void generated_value;
`,
	);
});

test("remote form enhance submit exposes form result Effects", async () => {
	await assert_type_checks(
		"remote-form-submit-result.ts",
		`
import { Effect } from "effect";
import type { RemoteFormInput } from "@sveltejs/kit";
import type { EffectRemoteFormEnhanceOptions } from "__RUNTIME__/modules/svelte-effect-runtime/src/remote/client.ts";

type SaveResult = { readonly ok: true };

declare const options: EffectRemoteFormEnhanceOptions<RemoteFormInput, SaveResult>;

const submit_effect: Effect.Effect<SaveResult | undefined, unknown, unknown> =
  options.submit();
const updates_effect: Effect.Effect<SaveResult | undefined, unknown, unknown> =
  options.submit().updates();

void submit_effect;
void updates_effect;
`,
	);
});

test("RequestEvent locals use SvelteKit App.Locals augmentation", async () => {
	await assert_type_checks(
		"request-event-locals.ts",
		`
import { Effect } from "effect";
import { RequestEvent } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";

declare global {
  namespace App {
    interface Locals {
      user: {
        id: string;
      };
    }
  }
}

Effect.gen(function* () {
  const event = yield* RequestEvent;
  const user_id: string = event.locals.user.id;

  return user_id;
});
`,
	);
});

async function assert_type_checks(filename: string, source: string): Promise<void> {
	const repo_root = fileURLToPath(new URL("../../..", import.meta.url));
	const tmp_root = join(repo_root, ".tmp");

	await mkdir(tmp_root, { recursive: true });

	const dir = await mkdtemp(join(tmp_root, "remote-client-types-"));
	const app_server_path = join(dir, "$app-server.ts");
	const source_path = join(dir, filename);
	const tsconfig_path = join(dir, "tsconfig.json");

	await writeFile(
		app_server_path,
		`
type MaybePromise<T> = T | Promise<T>;

export function query<Output>(fn: () => MaybePromise<Output>): unknown;
export function query(..._args: unknown[]): unknown {
  return undefined;
}
export namespace query {
  export function batch(..._args: unknown[]): unknown {
    return undefined;
  }

  export function live(..._args: unknown[]): unknown {
    return undefined;
  }
}

export function command<Output>(fn: () => MaybePromise<Output>): unknown;
export function command(..._args: unknown[]): unknown {
  return undefined;
}

export function form(..._args: unknown[]): unknown {
  return undefined;
}

export function getRequestEvent(): unknown {
  return undefined;
}

export function prerender(..._args: unknown[]): unknown {
  return undefined;
}
`,
	);

	await writeFile(source_path, source.replaceAll("__RUNTIME__", to_posix_path(repo_root)));

	await writeFile(
		tsconfig_path,
		JSON.stringify(
			{
				compilerOptions: {
					allowImportingTsExtensions: true,
					baseUrl: `${to_posix_path(repo_root)}/modules/svelte-effect-runtime`,
					ignoreDeprecations: "6.0",
					lib: ["dom", "dom.iterable", "es2022"],
					module: "nodenext",
					moduleResolution: "nodenext",
					noEmit: true,
					exactOptionalPropertyTypes: true,
					paths: {
						"@sveltejs/kit": ["./node_modules/@sveltejs/kit"],
						"@sveltejs/kit/*": ["./node_modules/@sveltejs/kit/*"],
						effect: ["./node_modules/effect"],
						"effect/*": ["./node_modules/effect/*"],
						svelte: ["./node_modules/svelte"],
						"svelte/*": ["./node_modules/svelte/*"],
						"$app/server": [to_posix_path(app_server_path)],
						$: ["./src/mod.ts"],
						"$/*": ["./src/*"],
					},
					skipLibCheck: true,
					strict: true,
					target: "es2022",
				},
				files: [to_posix_path(source_path)],
			},
			null,
			2,
		),
	);

	const output = spawnSync("vp", ["exec", "tsc", "-p", tsconfig_path], {
		cwd: repo_root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	assert_equals(output.status ?? 1, 0, `${output.stdout}${output.stderr}`);
}

function to_posix_path(path: string): string {
	return path.replaceAll("\\", "/");
}
