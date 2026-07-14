import { fileURLToPath } from "node:url";

function vite_path(url: URL): string {
	return fileURLToPath(url).replaceAll("\\", "/");
}

const ignored_paths = [
	"**/node_modules/**",
	"**/.dist/**",
	"**/.tmp/**",
	"**/.svelte-kit/**",
	"**/.vercel/**",
	"**/*.tgz",
	"**/*.vsix",
	"coverage/**",
	"modules/svelte-effect-runtime-language-server/runtime/**",
	"modules/svelte-effect-runtime-vsix/runtime/**",
	"pnpm-lock.yaml",
];

export default {
	fmt: {
		ignorePatterns: ignored_paths,
		tabWidth: 4,
		useTabs: true,
	},
	lint: {
		ignorePatterns: ignored_paths,
	},
	resolve: {
		alias: [
			{
				find: "@sveltejs/kit",
				replacement: vite_path(
					new URL("./node_modules/@sveltejs/kit/src/exports/index.js", import.meta.url),
				),
			},
			{
				find: "$app/server",
				replacement: vite_path(
					new URL(
						"./.tests/svelte-effect-runtime/unit/fixtures/app-server.ts",
						import.meta.url,
					),
				),
			},
			{
				find: /^\$\//,
				replacement: vite_path(
					new URL("./modules/svelte-effect-runtime/src/", import.meta.url),
				),
			},
			{
				find: /^\$$/,
				replacement: vite_path(
					new URL("./modules/svelte-effect-runtime/src/mod.ts", import.meta.url),
				),
			},
			{
				find: "svelte-effect-runtime-grammars",
				replacement: vite_path(
					new URL("./modules/svelte-effect-runtime-grammars/src/mod.ts", import.meta.url),
				),
			},
			{
				find: /^svelte-effect-runtime\/internal\//,
				replacement: vite_path(
					new URL("./modules/svelte-effect-runtime/src/internal/", import.meta.url),
				),
			},
			{
				find: /^svelte-effect-runtime\//,
				replacement: vite_path(
					new URL("./modules/svelte-effect-runtime/src/", import.meta.url),
				),
			},
			{
				find: "svelte-effect-runtime",
				replacement: vite_path(
					new URL("./modules/svelte-effect-runtime/src/mod.ts", import.meta.url),
				),
			},
		],
	},
	test: {
		include: [".tests/*/**/*.test.ts"],
		exclude: [".tests/**/consumer/**/*.spec.ts", ".tests/**/signals/**/*.browser.test.ts"],
		testTimeout: 30_000,
	},
};
