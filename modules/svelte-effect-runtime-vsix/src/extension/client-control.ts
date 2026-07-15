import type { SerializedClientHandle } from "./client-lifecycle.ts";
import { Context, Effect } from "effect";

export class LanguageClientControl extends Context.Service<
	LanguageClientControl,
	{
		readonly start: (server_path: string) => Effect.Effect<void, unknown>;
		readonly stop: Effect.Effect<void, unknown>;
	}
>()("svelte-effect-runtime-vsix/LanguageClientControl") {}

export class LanguageClientFactory extends Context.Service<
	LanguageClientFactory,
	{
		readonly create: (server_path: string) => Effect.Effect<SerializedClientHandle, unknown>;
	}
>()("svelte-effect-runtime-vsix/LanguageClientFactory") {}
