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

Deno.test("server remote helpers stay Effect-yieldable in markup helpers", async () => {
  await assert_type_checks(
    "server-remote-markup.ts",
    `
import { Effect, Schema, Stream } from "effect";
import { Command, Form, Query } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
import type { EffectRemoteLiveSource } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
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
    known: ids.includes(id),
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

const SignOut = Form(Effect.succeed({ signedOut: true }));

type GetPostsParameters = Parameters<typeof GetPosts>;
type GetPostSummaryParameters = Parameters<typeof GetPostSummary>;
type GetClockParameters = Parameters<typeof GetClock>;
type GetNativeClockParameters = Parameters<typeof GetNativeClock>;
type UpvotePostParameters = Parameters<typeof UpvotePost>;
type SignInParameters = Parameters<typeof SignIn>;
type SignInInput = SignInParameters[0];
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

async function check_generated_markup_helpers() {
  const posts_query = GetPosts();
  const summary_query = GetPostSummary("one");
  const clock_query = GetClock("main");
  const refresh_effect: Effect.Effect<void, unknown, never> =
    posts_query.refresh();
  const reconnect_effect: Effect.Effect<void, unknown, never> =
    clock_query.reconnect();
  const sign_out_effect = SignOut();

  posts_query.set(posts);
  const release_override = posts_query.withOverride((current) => current);

  release_override();
  await Effect.runPromise(refresh_effect);
  await Effect.runPromise(reconnect_effect);
  await Effect.runPromise(summary_query.refresh());
  const sign_out_result = await Effect.runPromise(sign_out_effect);
  const summary = await Effect.runPromise(summary_query);
  const clock_value = await Effect.runPromise(clock_query);
  const native_clock_value = await Effect.runPromise(GetNativeClock());
  const signed_out: boolean = sign_out_result.signedOut;
  const connected: boolean = clock_query.connected;
  const done: boolean = clock_query.done;
  const summary_id: string = summary.id;
  const summary_index: number = summary.index;
  const summary_known: boolean = summary.known;
  const clock_number: number = clock_value;
  const native_clock_string: string = native_clock_value;

  for await (const value of clock_query) {
    const streamed_value: number = value;

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
  void summary_id;
  void summary_index;
  void summary_known;
  void clock_number;
  void native_clock_string;
  void live_source;
}

void check_generated_markup_helpers;
`,
  );
});

async function assert_type_checks(
  filename: string,
  source: string,
): Promise<void> {
  const repo_root = join(Deno.cwd(), "../..");
  const dir = await Deno.makeTempDir({ dir: join(repo_root, ".tmp") });
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
          lib: ["dom", "dom.iterable", "es2022"],
          module: "nodenext",
          moduleResolution: "nodenext",
          noEmit: true,
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

  const command = new Deno.Command("npm.cmd", {
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
