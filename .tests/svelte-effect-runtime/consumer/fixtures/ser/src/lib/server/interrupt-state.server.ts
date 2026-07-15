import { Effect } from "effect";

const interrupt_events: string[] = [];

export const RecordInterruptEvent = (event: string) =>
	Effect.sync(() => {
		interrupt_events.push(event);
	});

export const ResetInterruptEvents = Effect.sync(() => {
	interrupt_events.length = 0;
});

export const GetInterruptEvents = Effect.sync(() => [...interrupt_events]);
