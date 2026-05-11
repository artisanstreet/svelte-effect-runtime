import adapter from '@sveltejs/adapter-auto';
import { effect_preprocess } from 'svelte-effect-runtime/preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [effect_preprocess()],
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		experimental: {
			remoteFunctions: true
		}
	}
};

export default config;
