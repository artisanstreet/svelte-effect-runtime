import { sveltekit } from '@sveltejs/kit/vite';
import { sveltekit_effect_runtime } from 'svelte-effect-runtime/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit_effect_runtime(), sveltekit()]
});
