declare module "*?signals-ssr" {
	import type { Component } from "svelte";

	const component: Component<Record<string, unknown>>;

	export default component;
}

declare module "virtual:signals-ssr-renderer" {
	export { render } from "svelte/server";
}
