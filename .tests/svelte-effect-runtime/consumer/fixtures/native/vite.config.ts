import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import adapter from "@sveltejs/adapter-node";

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			paths: {
				__CONFORMANCE_PATHS_ORIGIN__: "__CONFORMANCE_ORIGIN__",
			},
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
