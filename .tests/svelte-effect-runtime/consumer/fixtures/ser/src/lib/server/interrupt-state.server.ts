import { Effect } from "effect";

const interrupt_events: string[] = [];

export const RecordInterruptEvent = (event: string) =>
	Effect.gen(function* () {
		interrupt_events.push(event);
	});

export const ResetInterruptEvents = Effect.gen(function* () {
	interrupt_events.length = 0;
});

export const GetInterruptEvents = Effect.gen(function* () {
	return [...interrupt_events];
});
