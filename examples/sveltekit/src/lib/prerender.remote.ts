import { Effect, Schema } from "effect";
import { Prerender } from "svelte-effect-runtime";
import { MissingTopic } from "$lib/errors";

interface Topic {
	readonly slug: string;
	readonly title: string;
	readonly body: string;
}

const TOPICS: ReadonlyArray<Topic> = [
	{ slug: "intro", title: "Intro", body: "Hello from the prerender step." },
	{ slug: "guide", title: "Guide", body: "Prerendered at build time." }
];

// Static at build time. `inputs` enumerates the slugs SvelteKit should
// prerender; without it, dev/build can't know what to evaluate ahead of
// time and the call returns undefined at runtime.
export const get_topic = Prerender(
	Schema.String,
	(slug) =>
		Effect.gen(function* () {
			const topic = TOPICS.find((t) => t.slug === slug);
			if (!topic) return yield* new MissingTopic({ slug });
			return topic;
		}),
	{
		inputs: function* () {
			for (const topic of TOPICS) yield topic.slug;
		}
	}
);

// Dynamic prerender — refresh on demand at runtime instead of build-time only.
export const get_topic_dynamic = Prerender(
	Schema.String,
	(slug) =>
		Effect.gen(function* () {
			const topic = TOPICS.find((t) => t.slug === slug);
			if (!topic) return yield* new MissingTopic({ slug });
			return { ...topic, snapshot_at: Date.now() };
		}),
	{ dynamic: true }
);
