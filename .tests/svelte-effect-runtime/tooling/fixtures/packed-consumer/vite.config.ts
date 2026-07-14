import { effect } from "svelte-effect-runtime/compiler";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		...effect(),
		sveltekit({
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
