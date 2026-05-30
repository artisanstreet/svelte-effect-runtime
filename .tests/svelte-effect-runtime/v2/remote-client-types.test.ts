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
import { Effect, Schema } from "effect";
import { Command, Query } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
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

const UpvotePost = Command(Schema.String, (id) =>
  Effect.gen(function* () {
    yield* GetPosts().refresh();

    return id.length;
  })
);

type GetPostsParameters = Parameters<typeof GetPosts>;
type UpvotePostParameters = Parameters<typeof UpvotePost>;
type GetPostsHasNoInputParameter = Assert<Equal<GetPostsParameters, []>>;
type UpvotePostStillRequiresInput = Assert<
  Equal<UpvotePostParameters, [input: string]>
>;

async function check_generated_markup_helpers() {
  const posts_query = GetPosts();
  const refresh_effect: Effect.Effect<void, unknown, never> =
    posts_query.refresh();

  posts_query.set(posts);
  const release_override = posts_query.withOverride((current) => current);

  release_override();
  await Effect.runPromise(refresh_effect);

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
