import { assertEquals } from "@std/assert";
import { join } from "@std/path";

Deno.test("remote form preflight keeps enhance callback Effect-aware", async () => {
  await assert_type_checks(
    "preflight-enhance.ts",
    `
import { Effect } from "effect";
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

form.preflight(schema).enhance(() => Effect.void);
`,
  );
});

Deno.test("remote form preflight keeps validate Effect-yieldable", async () => {
  await assert_type_checks(
    "preflight-validate.ts",
    `
import { Effect } from "effect";
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
});
`,
  );
});

Deno.test("remote form enhance submit keeps native success types", async () => {
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
          const success: boolean = value;

          return success;
        },
        onFailure: (cause) => {
          const failure_cause: Cause.Cause<RemoteFailure<unknown>> = cause;

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

Deno.test("server remote helpers stay Effect-yieldable in markup helpers", async () => {
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

  await run(function* () {
    const count = yield* UpvotePost(id);
    const next_likes: number = likes + count;

    return next_likes;
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
}

void check_generated_markup_helpers;
`,
  );
});

Deno.test("RequestEvent locals use SvelteKit App.Locals augmentation", async () => {
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

async function assert_type_checks(
  filename: string,
  source: string,
): Promise<void> {
  const repo_root = join(Deno.cwd(), "../..");
  const tmp_root = join(repo_root, ".tmp");

  await Deno.mkdir(tmp_root, { recursive: true });

  const dir = await Deno.makeTempDir({ dir: tmp_root });
  const app_server_path = join(dir, "$app-server.ts");
  const source_path = join(dir, filename);
  const tsconfig_path = join(dir, "tsconfig.json");

  await Deno.writeTextFile(
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

  await Deno.writeTextFile(
    source_path,
    source.replaceAll("__RUNTIME__", to_posix_path(repo_root)),
  );

  await Deno.writeTextFile(
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
            "$app/server": [to_posix_path(app_server_path)],
            "$": ["./src/mod.ts"],
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

  const npm_command = Deno.build.os === "windows" ? "npm.cmd" : "npm";
  const command = new Deno.Command(npm_command, {
    args: [
      "exec",
      "tsc",
      "--",
      "-p",
      tsconfig_path,
    ],
    cwd: repo_root,
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();

  assertEquals(
    output.code,
    0,
    `${new TextDecoder().decode(output.stdout)}${
      new TextDecoder().decode(output.stderr)
    }`,
  );
}

function to_posix_path(path: string): string {
  return path.replaceAll("\\", "/");
}
