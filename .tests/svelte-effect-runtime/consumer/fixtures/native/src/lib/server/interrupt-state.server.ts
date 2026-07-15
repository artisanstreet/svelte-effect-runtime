const interrupt_events: string[] = [];

export function record_interrupt_event(event: string): void {
	interrupt_events.push(event);
}

export function reset_interrupt_events(): void {
	interrupt_events.length = 0;
}

export function get_interrupt_events(): ReadonlyArray<string> {
	return [...interrupt_events];
}
