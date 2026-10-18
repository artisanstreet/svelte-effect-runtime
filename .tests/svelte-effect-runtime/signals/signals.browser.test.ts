import { hydrate, mount, tick, unmount, type Component } from "svelte";
import { describe, expect, test } from "vitest";
import { render } from "virtual:signals-ssr-renderer";

import NativeLifecycleMissingAdvance from "./fixtures/native-lifecycle-missing-advance.svelte";
import NativeLifecycleServer from "./fixtures/native-lifecycle.svelte?signals-ssr";
import SerHydrationHtml from "./fixtures/ser-hydration.svelte?signals-ssr-html";
import SerRunScopeLifecycle from "./fixtures/ser-run-scope-lifecycle.svelte";
import SerLifecycleServer from "./fixtures/ser-lifecycle.svelte?signals-ssr";
import NativeReactivity from "./fixtures/native-reactivity.svelte";
import NativeLifecycle from "./fixtures/native-lifecycle.svelte";
import SerReactivity from "./fixtures/ser-reactivity.svelte";
import SerLifecycle from "./fixtures/ser-lifecycle.svelte";
import SerHydration from "./fixtures/ser-hydration.svelte";
import SerProvider from "./fixtures/ser-provider.svelte";
import NativeFork from "./fixtures/native-fork.svelte";
import SerAbort from "./fixtures/ser-abort.svelte";
import SerFork from "./fixtures/ser-fork.svelte";

interface ReactivityProps {
	resolve_value: (primary: number, secondary: number) => Promise<string>;
}

interface LifecycleProps {
	record_event: (event: string) => void;
}

interface ResolutionRequest {
	key: string;
	resolve: (value: string) => void;
}

interface ReactivityObservation {
	requests: string[];
	initial_value: string;
	before_resolution: string;
	after_resolution_sync: string;
	after_resolution_microtask: string;
	after_resolution_tick: string;
	primary_value: string;
	secondary_value: string;
}

class ResolutionDriver {
	#requests: ResolutionRequest[] = [];
	#request_waiters: Array<(request: ResolutionRequest) => void> = [];
	readonly observed_keys: string[] = [];

	resolve_value = (primary: number, secondary: number): Promise<string> => {
		const gate = Promise.withResolvers<string>();
		const request = {
			key: `${primary}:${secondary}`,
			resolve: gate.resolve,
		};
		const waiter = this.#request_waiters.shift();

		this.observed_keys.push(request.key);

		if (waiter) {
			waiter(request);
		} else {
			this.#requests.push(request);
		}

		return gate.promise;
	};

	next_request(): Promise<ResolutionRequest> {
		const request = this.#requests.shift();

		if (request) {
			return Promise.resolve(request);
		}

		return new Promise((resolve_request) => {
			this.#request_waiters.push(resolve_request);
		});
	}
}

class EventRecorder {
	#events: string[] = [];
	#pending_events: string[] = [];
	#event_waiters: Array<(event: string) => void> = [];

	record_event = (event: string): void => {
		const waiter = this.#event_waiters.shift();

		this.#events.push(event);

		if (waiter) {
			waiter(event);
		} else {
			this.#pending_events.push(event);
		}
	};

	next_event(): Promise<string> {
		const event = this.#pending_events.shift();

		if (event) {
			return Promise.resolve(event);
		}

		return new Promise((resolve_event) => this.#event_waiters.push(resolve_event));
	}

	snapshot(): string[] {
		return [...this.#events];
	}
}

function create_target(): HTMLDivElement {
	const target = document.createElement("div");

	document.body.append(target);

	return target;
}

function find_test_element(target: HTMLElement, test_id: string): HTMLElement {
	const element = target.querySelector(`[data-testid="${test_id}"]`);

	if (!(element instanceof HTMLElement)) {
		throw new Error(`Missing element with data-testid=${test_id}`);
	}

	return element;
}

function read_test_text(target: HTMLElement, test_id: string): string {
	return target.querySelector(`[data-testid="${test_id}"]`)?.textContent ?? "";
}

function wait_for_test_text(
	target: HTMLElement,
	test_id: string,
	expected_text: string,
): Promise<void> {
	if (read_test_text(target, test_id) === expected_text) {
		return Promise.resolve();
	}

	return new Promise((resolve_text) => {
		const observer = new MutationObserver(() => {
			if (read_test_text(target, test_id) !== expected_text) {
				return;
			}

			observer.disconnect();
			resolve_text();
		});

		observer.observe(target, {
			characterData: true,
			childList: true,
			subtree: true,
		});
	});
}

async function observe_reactivity(
	component: Component<ReactivityProps>,
): Promise<ReactivityObservation> {
	const driver = new ResolutionDriver();
	const target = create_target();
	const instance = mount(component, {
		target,
		props: { resolve_value: driver.resolve_value },
	});

	try {
		const initial_request = await driver.next_request();
		const initial_visible = wait_for_test_text(target, "value", "resolved:1:10");

		initial_request.resolve("resolved:1:10");
		await initial_visible;

		const initial_value = read_test_text(target, "value");

		find_test_element(target, "primary").click();
		const primary_request = await driver.next_request();
		const primary_visible = wait_for_test_text(target, "value", "resolved:2:10");
		const before_resolution = read_test_text(target, "value");

		primary_request.resolve("resolved:2:10");

		const after_resolution_sync = read_test_text(target, "value");

		await Promise.resolve();

		const after_resolution_microtask = read_test_text(target, "value");

		await tick();

		const after_resolution_tick = read_test_text(target, "value");

		await primary_visible;

		const primary_value = read_test_text(target, "value");

		find_test_element(target, "secondary").click();
		const secondary_request = await driver.next_request();
		const secondary_visible = wait_for_test_text(target, "value", "resolved:2:11");

		secondary_request.resolve("resolved:2:11");
		await secondary_visible;

		return {
			requests: driver.observed_keys,
			initial_value,
			before_resolution,
			after_resolution_sync,
			after_resolution_microtask,
			after_resolution_tick,
			primary_value,
			secondary_value: read_test_text(target, "value"),
		};
	} finally {
		try {
			await unmount(instance);
		} finally {
			target.remove();
		}
	}
}

async function observe_lifecycle(component: Component<LifecycleProps>): Promise<string[]> {
	const recorder = new EventRecorder();
	const target = create_target();
	const first_start = recorder.next_event();
	let instance: ReturnType<typeof mount> | undefined;

	try {
		instance = mount(component, {
			target,
			props: { record_event: recorder.record_event },
		});

		await first_start;

		const first_finalize = recorder.next_event();

		find_test_element(target, "advance").click();
		await first_finalize;

		const second_start = recorder.next_event();

		await second_start;

		const second_finalize = recorder.next_event();
		const mounted_instance = instance;

		instance = undefined;
		await unmount(mounted_instance);
		await second_finalize;
		await Promise.resolve();
		await tick();

		return recorder.snapshot();
	} finally {
		try {
			if (instance) {
				await unmount(instance);
			}
		} finally {
			target.remove();
		}
	}
}

async function observe_ser_run_scope_lifecycle(run_count: number): Promise<string[]> {
	const recorder = new EventRecorder();
	const target = create_target();
	let instance: ReturnType<typeof mount> | undefined;

	try {
		instance = mount(SerRunScopeLifecycle, {
			target,
			props: { record_event: recorder.record_event },
		});

		for (let generation = 1; generation <= run_count; generation += 1) {
			expect(await recorder.next_event()).toBe(`start:${generation}`);

			find_test_element(target, "publish-run-scope").click();
			expect(await recorder.next_event()).toBe(`value:${generation}:${generation}`);

			if (generation === run_count) {
				continue;
			}

			find_test_element(target, "advance-run-scope").click();
			expect(await recorder.next_event()).toBe(`finalize:${generation}`);
		}

		const mounted_instance = instance;
		instance = undefined;
		await unmount(mounted_instance);
		expect(await recorder.next_event()).toBe(`finalize:${run_count}`);
		await Promise.resolve();
		await tick();

		return recorder.snapshot();
	} finally {
		try {
			if (instance) {
				await unmount(instance);
			}
		} finally {
			target.remove();
		}
	}
}

async function observe_ssr_hydration(
	server_component: Component<Record<string, unknown>>,
	client_component: Component<LifecycleProps>,
): Promise<{
	server_generation: string;
	hydrated_generation: string;
	updated_generation: string;
	hydration_events: string[];
}> {
	const recorder = new EventRecorder();
	const rendered = render(server_component, {
		props: { record_event: recorder.record_event },
	});
	const target = create_target();
	let instance: ReturnType<typeof hydrate> | undefined;

	try {
		target.innerHTML = rendered.body;

		const server_generation = read_test_text(target, "generation");
		const first_start = recorder.next_event();

		instance = hydrate(client_component, {
			target,
			props: { record_event: recorder.record_event },
		});

		await first_start;

		const hydrated_generation = read_test_text(target, "generation");
		const first_finalize = recorder.next_event();
		const updated_visible = wait_for_test_text(target, "generation", "2");

		find_test_element(target, "advance").click();
		await first_finalize;

		const second_start = recorder.next_event();

		await second_start;
		await updated_visible;

		const updated_generation = read_test_text(target, "generation");
		const second_finalize = recorder.next_event();
		const hydrated_instance = instance;

		instance = undefined;
		await unmount(hydrated_instance);
		await second_finalize;

		const hydration_events = recorder.snapshot();

		return { server_generation, hydrated_generation, updated_generation, hydration_events };
	} finally {
		try {
			if (instance) {
				await unmount(instance);
			}
		} finally {
			target.remove();
		}
	}
}

/** Runs the server's hydration script the way a page load would. */
function install_server_head(head: string): HTMLScriptElement {
	const script = document.createElement("script");

	script.textContent = /<script[^>]*>([\s\S]*)<\/script>/.exec(head)?.[1] ?? "";
	document.head.append(script);

	return script;
}

async function observe_server_hydration(): Promise<{
	script: string;
	markup: string;
	plain: string;
	opaque: string;
	client_events: string[];
}> {
	const recorder = new EventRecorder();
	const server_head = install_server_head(SerHydrationHtml.head);
	const target = create_target();
	let instance: ReturnType<typeof hydrate> | undefined;

	try {
		target.innerHTML = SerHydrationHtml.body;

		instance = hydrate(SerHydration, {
			target,
			props: { record_event: recorder.record_event },
		});

		await wait_for_test_text(target, "opaque", "client");
		await wait_for_test_text(target, "plain", "client");
		await tick();

		return {
			script: read_test_text(target, "script"),
			markup: read_test_text(target, "markup"),
			plain: read_test_text(target, "plain"),
			opaque: read_test_text(target, "opaque"),
			client_events: recorder.snapshot().sort(),
		};
	} finally {
		try {
			if (instance) {
				await unmount(instance);
			}
		} finally {
			target.remove();
			server_head.remove();
			delete (window as { __svelte?: unknown }).__svelte;
		}
	}
}

/** Speculates a state change in `fork()`, checks nothing is applied, then commits it. */
async function observe_fork(component: Component<LifecycleProps>): Promise<string[]> {
	const recorder = new EventRecorder();
	const target = create_target();
	const instance = mount(component, {
		target,
		props: { record_event: recorder.record_event },
	}) as { speculate: () => { commit: () => Promise<void> } };

	try {
		await wait_for_test_text(target, "value", "ready:1");

		const speculation = instance.speculate();

		await tick();
		expect(read_test_text(target, "value")).toBe("ready:1");

		await speculation.commit();
		await wait_for_test_text(target, "value", "ready:2");

		return recorder.snapshot();
	} finally {
		await unmount(instance);
		target.remove();
	}
}

describe("Signals browser conformance", () => {
	test("tracks dependencies and composes async completion with Svelte flush timing", async () => {
		const native_observation = await observe_reactivity(NativeReactivity);
		const ser_observation = await observe_reactivity(SerReactivity);

		expect(native_observation.requests).toEqual(["1:10", "2:10", "2:11"]);
		expect(native_observation.primary_value).toBe("resolved:2:10");
		expect(native_observation.secondary_value).toBe("resolved:2:11");
		expect(ser_observation).toEqual(native_observation);
	});

	test("stops owned reactive work when dependencies change and the component is disposed", async () => {
		const native_events = await observe_lifecycle(NativeLifecycle);
		const ser_events = await observe_lifecycle(SerLifecycle);

		expect(native_events).toEqual(["start:1", "finalize:1", "start:2", "finalize:2"]);
		expect(ser_events).toEqual(native_events);
	});

	test("keeps one forkScoped PubSub subscriber across reactive reruns", async () => {
		const run_count = 32;
		const events = await observe_ser_run_scope_lifecycle(run_count);
		const expected_events = Array.from({ length: run_count }, (_, index) => {
			const generation = index + 1;

			return [
				`start:${generation}`,
				`value:${generation}:${generation}`,
				`finalize:${generation}`,
			];
		}).flat();

		expect(events).toEqual(expected_events);
	});

	test("removes mounted targets when lifecycle observation fails", async () => {
		const initial_child_count = document.body.childElementCount;

		await expect(observe_lifecycle(NativeLifecycleMissingAdvance)).rejects.toThrow(
			"Missing element with data-testid=advance",
		);
		expect(document.body.childElementCount).toBe(initial_child_count);
	});

	test("matches native SSR output through hydration and the first client update", async () => {
		const native_observation = await observe_ssr_hydration(
			NativeLifecycleServer,
			NativeLifecycle,
		);
		const ser_observation = await observe_ssr_hydration(SerLifecycleServer, SerLifecycle);

		expect(native_observation).toEqual({
			server_generation: "1",
			hydrated_generation: "1",
			updated_generation: "2",
			hydration_events: ["start:1", "finalize:1", "start:2", "finalize:2"],
		});
		expect(ser_observation).toEqual(native_observation);
	});

	test("hydrates Hydratable server results and reruns everything else on the client", async () => {
		const observation = await observe_server_hydration();

		expect(SerHydrationHtml.body).toContain('data-testid="plain">server</output>');
		expect(observation).toEqual({
			script: "server",
			markup: "server",
			plain: "client",
			opaque: "client",
			client_events: ["opaque", "plain"],
		});
	});

	test("interrupts a pending markup Effect when Svelte discards its block", async () => {
		const recorder = new EventRecorder();
		const target = create_target();
		const instance = mount(SerAbort, {
			target,
			props: { record_event: recorder.record_event },
		});

		try {
			expect(await recorder.next_event()).toBe("started");

			const interrupted = recorder.next_event();

			find_test_element(target, "hide").click();

			expect(await interrupted).toBe("interrupted");
			expect(read_test_text(target, "mounted")).toBe("mounted");
		} finally {
			await unmount(instance);
			target.remove();
		}
	});

	test("gives descendants the services of every ancestor ProvideLayer", async () => {
		const recorder = new EventRecorder();
		const target = create_target();
		const instance = mount(SerProvider, {
			target,
			props: { record_event: recorder.record_event },
		});

		try {
			await wait_for_test_text(target, "greeting", "hello");
			await wait_for_test_text(target, "punctuated", "hello!");

			const released = recorder.next_event().then(() => recorder.next_event());

			await unmount(instance);

			expect(await released).toBe("release");
			expect(recorder.snapshot()).toEqual(["acquire", "release"]);
		} finally {
			target.remove();
		}
	});

	test("matches native fork speculation and commit", async () => {
		const native_events = await observe_fork(NativeFork);
		const ser_events = await observe_fork(SerFork);

		expect(native_events).toEqual(["load:1", "load:2"]);
		expect(ser_events).toEqual(native_events);
	});
});
