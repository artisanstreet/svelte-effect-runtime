import type { Plugin } from "vite";

const public_module_id = "$ser/env/public";
const private_module_id = "$ser/env/private";
const virtual_prefix = "\0virtual:";

type EnvironmentKind = "private" | "public";

/** Vite integration for Effect-wrapped SvelteKit environment modules. */
export function make_environment_plugin(): Plugin {
	return {
		name: "svelte-effect-runtime:environment",
		enforce: "post",

		resolveId(id) {
			if (id !== public_module_id && id !== private_module_id) {
				return undefined;
			}

			return `${virtual_prefix}${id}`;
		},

		async load(id) {
			if (!id.startsWith(virtual_prefix)) {
				return undefined;
			}

			const source_id = id.slice(virtual_prefix.length);
			const kind = get_environment_kind(source_id);

			if (!kind) {
				return undefined;
			}

			const internal_id = get_sveltekit_environment_id(kind, this.environment.name);
			const resolved = await this.resolve(internal_id, undefined, { skipSelf: true });

			if (!resolved) {
				this.error(`Unable to resolve SvelteKit environment module ${internal_id}.`);
			}

			const loaded = await this.load({ id: resolved.id });
			const names = find_environment_exports(loaded.code ?? "");

			return make_environment_module(kind, names);
		},
	};
}

function get_environment_kind(id: string): EnvironmentKind | undefined {
	if (id === private_module_id) {
		return "private";
	}

	if (id === public_module_id) {
		return "public";
	}

	return undefined;
}

function get_sveltekit_environment_id(kind: EnvironmentKind, environment_name: string): string {
	if (kind === "private") {
		return "__sveltekit/env/private";
	}

	return environment_name === "client"
		? "__sveltekit/env/public/client"
		: "__sveltekit/env/public/server";
}

export function find_environment_exports(code: string): string[] {
	return [...code.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g)]
		.map((match) => match[1])
		.filter((name): name is string => name !== undefined);
}

export function make_environment_module(kind: EnvironmentKind, names: readonly string[]): string {
	const source_id = `$app/env/${kind}`;
	const imports = [
		`import { Effect } from "effect";`,
		``,
		`import * as environment_values from ${JSON.stringify(source_id)};`,
	];
	const declarations = names.map(
		(name) => `export const ${name} = Effect.succeed(environment_values.${name});`,
	);

	return [...imports, "", ...declarations, ""].join("\n");
}
