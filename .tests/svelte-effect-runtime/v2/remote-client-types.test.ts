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

async function assert_type_checks(
  filename: string,
  source: string,
): Promise<void> {
  const repo_root = join(Deno.cwd(), "../..");
  const dir = await Deno.makeTempDir({ dir: join(repo_root, ".tmp") });
  const source_path = join(dir, filename);
  const tsconfig_path = join(dir, "tsconfig.json");

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
