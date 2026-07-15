import { Effect } from "effect";

const lifecycle_events: string[] = [];

export const GetLifecycleEvents = Effect.gen(function* () {
	return [...lifecycle_events];
});

export const RecordLifecycleEvent = (event: string) =>
	Effect.gen(function* () {
		lifecycle_events.push(event);
	});

export const ResetLifecycleEvents = Effect.gen(function* () {
	lifecycle_events.length = 0;
});
