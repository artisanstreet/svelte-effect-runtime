import { effect } from "svelte-effect-runtime/compiler";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import adapter from "@sveltejs/adapter-node";

export default defineConfig({
	plugins: [
		...effect(),
		sveltekit({
			adapter: adapter(),
			compilerOptions: {
				experimental: {
					async: true,
				},
			},
			experimental: {
				remoteFunctions: true,
			},
		}),
	],
});
