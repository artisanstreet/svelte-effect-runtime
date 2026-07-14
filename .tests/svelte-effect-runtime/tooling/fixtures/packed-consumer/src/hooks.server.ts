import { ServerRuntime } from "svelte-effect-runtime/server";

export const init = () => {
	ServerRuntime.make();
};
