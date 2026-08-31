import {
	expect,
	test,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Page,
	type Playwright,
	type TestInfo,
} from "@playwright/test";
import type { Observation, Scenario, TargetName } from "../../unit/harness/model.ts";
import { resolve_sveltekit_target_names } from "../harness/sveltekit-profiles.ts";
import { normalize_observation } from "../../unit/harness/normalization.ts";
import { get_conformance_proxy_url } from "../../unit/harness/model.ts";
import { compare_observations } from "../../unit/harness/comparison.ts";
import { make_evidence } from "../../unit/harness/evidence.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type PageObservation = {
	readonly initial: Readonly<Record<string, string>>;
	readonly interactions: Readonly<Record<string, string>>;
};

type TargetEndpoint = {
	readonly name: TargetName;
	readonly url: string;
};

type ApplicationDriver = {
	readonly browser: Browser;
	readonly playwright: Playwright;
	readonly target: TargetEndpoint;
};

type RemoteTraffic = {
	readonly method: string;
	readonly path: string;
	readonly request_content_type: string;
	readonly request_cookie: boolean;
	readonly request_id: string;
	readonly request_payload: string;
	readonly request_payload_bytes: number;
	readonly response_body: string;
	readonly response_content_type: string;
	readonly response_location: string;
	readonly response_payload_bytes: number;
	readonly response_set_cookie: boolean;
	readonly response_stream_payload: string;
	readonly response_streamed: boolean;
	readonly status: number;
};

type RemoteTrafficRecorder = {
	readonly stop: () => Promise<void>;
	readonly traffic: RemoteTraffic[];
};

type MutableRemoteTraffic = {
	-readonly [Key in keyof RemoteTraffic]: RemoteTraffic[Key];
};

type QueryObservation = {
	readonly build_snapshot: string;
	readonly cache_delta: number;
	readonly cache_state: string;
	readonly failure: string;
	readonly failure_property: string;
	readonly runtime_snapshot: string;
	readonly slow_loading: string;
	readonly slow_result: string;
	readonly traffic: ReadonlyArray<RemoteTraffic>;
};

type CommandObservation = {
	readonly failure: string;
	readonly mutation_delta: number;
	readonly pending_during_request: string;
	readonly redirect: string;
	readonly result: string;
	readonly slow_result: string;
	readonly traffic: ReadonlyArray<RemoteTraffic>;
};

type FormObservation = {
	readonly invalid_issue: string;
	readonly pending_during_request: string;
	readonly redirect_path: string;
	readonly reset_amount: string;
	readonly reset_label: string;
	readonly result: string;
	readonly result_lifecycle: string;
	readonly slow_result: string;
	readonly traffic: ReadonlyArray<RemoteTraffic>;
};

type InterruptionObservation = {
	readonly events: ReadonlyArray<string>;
};

type LiveObservation = {
	readonly availability: string;
	readonly done: ReadonlyArray<string>;
	readonly initial_active_connections: number;
	readonly initial_finalizations: number;
	readonly initial_starts: number;
	readonly reconnect_active_connections: number;
	readonly reconnect_start_delta: number;
	readonly status: ReadonlyArray<string>;
	readonly traffic: ReadonlyArray<RemoteTraffic>;
	readonly update: ReadonlyArray<string>;
};

type PrerenderObservation = {
	readonly outcome: string;
	readonly status: number;
};

type TransportBoundaryObservation = {
	readonly malformed_body_kind: string;
	readonly malformed_exposes_internals: boolean;
	readonly malformed_status: number;
	readonly method: string;
	readonly path: string;
	readonly typed_failure: string;
};

type HandlerObservation = {
	readonly action: Readonly<Record<string, string>>;
	readonly failure_body: string;
	readonly failure_status: number;
	readonly load: Readonly<Record<string, string>>;
	readonly traffic: ReadonlyArray<RemoteTraffic>;
};

type HandlerControlObservation = {
	readonly error_body: string;
	readonly error_status: number;
	readonly redirect_location: string;
	readonly redirect_status: number;
};

type KeyedFormObservation = {
	readonly alpha_issue: string;
	readonly alpha_lifecycle: string;
	readonly alpha_result: string;
	readonly beta_issue: string;
	readonly beta_lifecycle: string;
	readonly beta_result: string;
};

type LiveFinalizationObservation = {
	readonly active_before_close: boolean;
	readonly finalized_after_close: boolean;
};

const targets: ReadonlyArray<TargetEndpoint> = resolve_sveltekit_target_names(process.env).map(
	(name) => ({ name, url: get_conformance_proxy_url(name) }),
);

const visible_test_ids = [
	"profile",
	"request",
	"dedupe",
	"batch",
	"live",
	"snapshot",
	"serialized",
	"markup",
	"if",
	"await",
	"key",
	"declaration",
	"html",
	"render",
] as const;

const query_behavior_scenario: Scenario<ApplicationDriver, QueryObservation> = {
	id: "query-state-cache-and-prerender",
	capability: "consumer",
	promise:
		"Query exposes native cache, loading, failure, refresh, and prerender fallback behavior",
	regression:
		"A client adapter can return values while losing resource state, cache refreshes, HTTP failures, or build-time prerender data",
	drive: observe_query_behavior,
};

const command_behavior_scenario: Scenario<ApplicationDriver, CommandObservation> = {
	id: "command-transport-and-invalidation",
	capability: "consumer",
	promise:
		"Command preserves POST context, pending state, invalidation, failures, and navigation",
	regression:
		"A command bridge can resolve successfully while sending the wrong method, skipping an update, or swallowing redirect and error control flow",
	drive: observe_command_behavior,
};

const transformed_form_scenario: Scenario<ApplicationDriver, FormObservation> = {
	id: "form-schema-enhancement",
	capability: "consumer",
	promise:
		"Enhanced forms preserve Schema decoding, rejection, pending state, reset, result, and redirects",
	regression:
		"An enhancement adapter can bypass Standard Schema transforms or corrupt lifecycle state while ordinary submissions still appear healthy",
	drive: observe_transformed_form,
};

const request_interruption_scenario: Scenario<ApplicationDriver, InterruptionObservation> = {
	id: "request-interruption-finalization",
	capability: "runtime",
	promise: "Aborting a real HTTP request interrupts its server work and runs finalizers",
	regression:
		"A Handler bridge can detach an Effect from the request signal and retain scoped resources after the client has gone away",
	drive: observe_request_interruption,
};

const live_query_scenario: Scenario<ApplicationDriver, LiveObservation> = {
	id: "live-ssr-sharing-update-and-reconnect",
	capability: "consumer",
	promise:
		"Live queries reuse hydration state, share connections, deliver updates, and reconnect",
	regression:
		"A live adapter can show its first SSR value while opening duplicate transports or losing later values and reconnect control",
	drive: observe_live_query,
};

const handler_scenario: Scenario<ApplicationDriver, HandlerObservation> = {
	id: "handler-load-action-contracts",
	capability: "consumer",
	promise: "Handler preserves native load and action arguments, results, and HTTP failures",
	regression:
		"A server wrapper can install request context for endpoints yet lose params, locals, route ids, or action failure control flow",
	drive: observe_handler_contracts,
};

const prerender_scenario: Scenario<ApplicationDriver, PrerenderObservation> = {
	id: "prerender-production-execution",
	capability: "consumer",
	promise: "Prerender executes from an installed package in a production SvelteKit server",
	regression:
		"A remote compiler can emit a buildable module whose production chunk references a missing prerender binding",
	drive: observe_prerender,
};

const transport_boundary_scenario: Scenario<ApplicationDriver, TransportBoundaryObservation> = {
	id: "typed-failure-and-malformed-transport",
	capability: "transport",
	promise: "Remote transport preserves typed failures and rejects malformed command payloads",
	regression:
		"A client bridge can decode expected failures while malformed wire data leaks implementation exceptions or bypasses the generated endpoint",
	drive: observe_transport_boundary,
};

const browser_contracts_scenario: Scenario<ApplicationDriver, PageObservation> = {
	id: "browser-visible-contracts",
	capability: "consumer",
	promise: "Native and supported SER targets expose the same browser-visible contracts",
	regression:
		"A packed consumer can build while hydration, remote forms, Signals, or transformed markup fail in a real browser",
	drive: observe_browser_contracts,
};

const unenhanced_form_scenario: Scenario<
	ApplicationDriver,
	{ readonly result: string; readonly url: string }
> = {
	id: "form-unenhanced-html-submission",
	capability: "transport",
	promise: "Remote forms preserve ordinary HTML submission without JavaScript",
	regression:
		"An enhancement-oriented adapter can pass browser tests while ordinary POST navigation loses the form result",
	drive: ({ browser, target }) => observe_unenhanced_form(browser, target),
};

const keyed_form_scenario: Scenario<ApplicationDriver, KeyedFormObservation> = {
	id: "form-keyed-instance-isolation",
	capability: "consumer",
	promise: "Enhanced keyed forms preserve reset, result, and instance isolation",
	regression:
		"A shared client form adapter can leak validation or result state between keyed instances",
	drive: observe_keyed_form,
};

const request_isolation_scenario: Scenario<
	ApplicationDriver,
	ReadonlyArray<Record<string, unknown>>
> = {
	id: "concurrent-request-context-isolation",
	capability: "runtime",
	promise: "Concurrent request contexts remain isolated",
	regression:
		"A process-global request store can overwrite params, cookies, locals, or route data while two handlers are suspended",
	drive: ({ playwright, target }) => observe_request_isolation(playwright, target),
};

const handler_control_scenario: Scenario<ApplicationDriver, HandlerControlObservation> = {
	id: "handler-redirect-and-http-error",
	capability: "transport",
	promise: "Handler preserves native redirects and HTTP errors",
	regression:
		"A server Effect runner can turn SvelteKit redirect and error control flow into an ordinary 500 response",
	drive: observe_handler_control,
};

const live_finalization_scenario: Scenario<ApplicationDriver, LiveFinalizationObservation> = {
	id: "live-page-close-finalization",
	capability: "runtime",
	promise: "Closing a live-query page finalizes its server stream",
	regression:
		"A live transport can retain its scoped Effect and server resources after the browser disconnects",
	drive: observe_live_finalization,
};

test(query_behavior_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(query_behavior_scenario, { browser, playwright }, test_info);
});

test(command_behavior_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(command_behavior_scenario, { browser, playwright }, test_info);
});

test(transformed_form_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(transformed_form_scenario, { browser, playwright }, test_info);
});

test(request_interruption_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(request_interruption_scenario, { browser, playwright }, test_info);
});

test(live_query_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(live_query_scenario, { browser, playwright }, test_info);
});

test(handler_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(handler_scenario, { browser, playwright }, test_info);
});

test(prerender_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(prerender_scenario, { browser, playwright }, test_info);
});

test(transport_boundary_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(transport_boundary_scenario, { browser, playwright }, test_info);
});

test(browser_contracts_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(browser_contracts_scenario, { browser, playwright }, test_info);
});

test(unenhanced_form_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(unenhanced_form_scenario, { browser, playwright }, test_info);
});

test(keyed_form_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(keyed_form_scenario, { browser, playwright }, test_info);
});

test(request_isolation_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(request_isolation_scenario, { browser, playwright }, test_info);
});

test(handler_control_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(handler_control_scenario, { browser, playwright }, test_info);
});

test(live_finalization_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(live_finalization_scenario, { browser, playwright }, test_info);
});

async function observe_browser_contracts({
	browser,
	target,
}: ApplicationDriver): Promise<PageObservation> {
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
		extraHTTPHeaders: { "x-request-id": "browser" },
	});
	const page = await context.newPage();
	const console_errors: string[] = [];
	const network: Array<{ method: string; path: string; status: number }> = [];

	page.on("console", (message) => {
		if (message.type() === "error") {
			console_errors.push(message.text());
		}
	});
	page.on("response", (response) => {
		const url = new URL(response.url());

		if (!url.pathname.includes("/_app/remote") && !url.searchParams.has("/remote")) {
			return;
		}

		network.push({
			method: response.request().method(),
			path: `${url.pathname}${url.search}`,
			status: response.status(),
		});
	});

	const observation = await observe_page(page);

	expect(console_errors, `${target.name} browser console`).toEqual([]);
	expect(network.length, `${target.name} remote traffic`).toBeGreaterThan(0);
	expect(network.every((response) => response.status < 400)).toBe(true);
	await context.close();

	return observation;
}

async function open_hydrated_page(page: Page, path: string): Promise<void> {
	await page.goto(path, { waitUntil: "domcontentloaded" });
	await expect(page.getByTestId("hydration-ready")).toHaveText("true");
}

async function observe_page(page: Page): Promise<PageObservation> {
	await open_hydrated_page(page, "/");

	await expect(page.getByTestId("profile")).toHaveText("profile:alpha:configured");
	await expect(page.getByTestId("request")).toHaveText("browser:none");
	await expect(page.getByTestId("batch")).toHaveText(/^\d+:alpha:alpha\|\d+:beta:beta$/);
	await expect(page.getByTestId("live")).toHaveText("live:first");
	await expect(page.getByTestId("snapshot")).toHaveText("snapshot:ready");
	await expect(page.getByTestId("serialized")).toHaveText(/true:\s*true:\s*true:\s*true:\s*42/);
	await expect(page.getByTestId("markup")).toHaveText("markup:ready");
	await expect(page.getByTestId("if")).toHaveText("if:ready");
	await expect(page.getByTestId("each")).toHaveText(/a\s*b/);
	await expect(page.getByTestId("await")).toHaveText("await:ready");
	await expect(page.getByTestId("key")).toHaveText("key:1");
	await expect(page.getByTestId("declaration")).toHaveText("declaration:ready");
	await expect(page.getByTestId("render")).toHaveText("render:ready");
	await expect(page.getByTestId("html")).toHaveText("html:ready");

	await expect(page.getByTestId("signal")).toHaveText("Signal 1");

	const dedupe = await page.getByTestId("dedupe").innerText();

	expect(dedupe).toMatch(/^(\d+):\1$/);

	const initial_entries = await Promise.all(
		visible_test_ids.map(async (test_id) => [
			test_id,
			(await page.getByTestId(test_id).allTextContents()).join("|"),
		]),
	);

	await page.getByTestId("refresh").click();
	await expect(page.getByTestId("profile")).toHaveText("profile:alpha:configured");
	await page.getByTestId("command-button").click();
	await expect(page.getByTestId("command")).toHaveText("command:1");
	await page.getByTestId("signal").click();
	await expect(page.getByTestId("signal")).toHaveText("Signal 2");
	await expect(page.getByTestId("key")).toHaveText("key:2");

	const command = await page.getByTestId("command").innerText();
	const key = await page.getByTestId("key").innerText();
	const signal = await page.getByTestId("signal").innerText();

	await page.getByTestId("name").fill("draft");
	await page.getByTestId("label").fill("alpha");
	await page.getByTestId("form-submit").click();
	await expect(page.getByTestId("form-result")).toHaveText("saved:draft:alpha");

	const form_result = await page.getByTestId("form-result").innerText();

	await expect(page.getByTestId("form-lifecycle")).toHaveText("true:0");

	const form_lifecycle = "true:0";

	await page.getByTestId("name").fill("draft");
	await page.getByTestId("label").fill("blocked");

	const invalid_response = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" && response.url().includes("CreateItem"),
	);

	await Promise.all([invalid_response, page.getByTestId("form-submit").click()]);
	await expect(page.getByTestId("form-all-issues")).not.toHaveText("[]", {
		timeout: 1_000,
	});

	const form_all_issues = await page.getByTestId("form-all-issues").innerText();

	await expect(page.getByTestId("form-issue"), form_all_issues).toHaveText(
		"Blocked labels are rejected.",
		{ timeout: 1_000 },
	);

	return {
		initial: Object.fromEntries(initial_entries),
		interactions: {
			command,
			form_all_issues,
			form_issue: await page.getByTestId("form-issue").innerText(),
			form_lifecycle,
			form_result,
			key,
			signal,
		},
	};
}

async function observe_unenhanced_form(
	browser: Browser,
	target: TargetEndpoint,
): Promise<{ result: string; url: string }> {
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
		javaScriptEnabled: false,
	});
	const page = await context.newPage();

	await page.goto("/", { waitUntil: "commit" });
	await expect(page.getByTestId("name")).toBeVisible();
	await page.getByTestId("name").fill("no-js");
	await page.getByTestId("label").fill("native-form");
	await Promise.all([
		page.waitForNavigation({ waitUntil: "commit" }),
		page.getByTestId("form-submit").click(),
	]);
	await expect(page.getByTestId("form-result")).toBeVisible();

	const observation = {
		result: await page.getByTestId("form-result").innerText(),
		url: new URL(page.url()).pathname,
	};

	expect(observation.result).toBe("saved:no-js:native-form");
	expect(observation.url).toBe("/");
	await context.close();

	return observation;
}

async function observe_keyed_form({
	browser,
	target,
}: ApplicationDriver): Promise<KeyedFormObservation> {
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
	});
	const page = await context.newPage();

	await open_hydrated_page(page, "/forms");
	await page.getByTestId("beta-name").fill("beta");
	await page.getByTestId("beta-label").fill("saved");
	await page.getByTestId("beta-submit").click();
	await expect(page.getByTestId("beta-result")).toHaveText("saved:beta:beta:saved");
	await expect(page.getByTestId("beta-name")).toHaveValue("");
	await expect(page.getByTestId("beta-label")).toHaveValue("");
	await expect(page.getByTestId("alpha-result")).toHaveText("idle");

	await page.getByTestId("alpha-name").fill("alpha");
	await page.getByTestId("alpha-label").fill("blocked");
	await page.getByTestId("alpha-submit").click();
	await expect(page.getByTestId("alpha-lifecycle")).toHaveText(/^(true|false):0$/);
	await expect(page.getByTestId("alpha-issue")).toHaveText("Blocked labels are rejected.");
	await expect(page.getByTestId("beta-result")).toHaveText("saved:beta:beta:saved");
	await expect(page.getByTestId("beta-issue")).toHaveText("valid");

	const observation = {
		alpha_issue: await page.getByTestId("alpha-issue").innerText(),
		alpha_lifecycle: await page.getByTestId("alpha-lifecycle").innerText(),
		alpha_result: await page.getByTestId("alpha-result").innerText(),
		beta_issue: await page.getByTestId("beta-issue").innerText(),
		beta_lifecycle: await page.getByTestId("beta-lifecycle").innerText(),
		beta_result: await page.getByTestId("beta-result").innerText(),
	};

	await context.close();

	return observation;
}

async function observe_request_isolation(
	playwright: Playwright,
	target: TargetEndpoint,
): Promise<ReadonlyArray<Record<string, unknown>>> {
	const control = await make_request_context(playwright, target);
	const make_request = async (client: string) => {
		const request = await playwright.request.newContext({
			baseURL: target.url,
			ignoreHTTPSErrors: true,
			extraHTTPHeaders: {
				cookie: `session=session-${client}`,
				"x-client": client,
				"x-request-id": `request-${client}`,
			},
		});

		return {
			complete: request
				.get(`/api/context/${client}`)
				.then(async (response) => (await response.json()) as Record<string, unknown>),
			request,
		};
	};

	await Promise.all([control.put("/api/gates/alpha"), control.put("/api/gates/beta")]);

	const alpha = await make_request("alpha");
	const beta = await make_request("beta");

	await Promise.all([wait_for_gate(control, "alpha"), wait_for_gate(control, "beta")]);
	await control.post("/api/gates/beta");

	const beta_observation = await beta.complete;
	const alpha_status = await control.get("/api/gates/alpha");

	expect(await alpha_status.json()).toEqual({ released: false, waiting: 1 });
	await control.post("/api/gates/alpha");

	const alpha_observation = await alpha.complete;
	const observations = [alpha_observation, beta_observation];

	await Promise.all([alpha.request.dispose(), beta.request.dispose(), control.dispose()]);

	expect(observations).toEqual([
		{
			after: {
				client: "alpha",
				parameter: "alpha",
				request_id: "request-alpha",
				route: "/api/context/[client]",
				session: "session-alpha",
				url: "/api/context/alpha",
			},
			before: {
				client: "alpha",
				parameter: "alpha",
				request_id: "request-alpha",
				route: "/api/context/[client]",
				session: "session-alpha",
				url: "/api/context/alpha",
			},
		},
		{
			after: {
				client: "beta",
				parameter: "beta",
				request_id: "request-beta",
				route: "/api/context/[client]",
				session: "session-beta",
				url: "/api/context/beta",
			},
			before: {
				client: "beta",
				parameter: "beta",
				request_id: "request-beta",
				route: "/api/context/[client]",
				session: "session-beta",
				url: "/api/context/beta",
			},
		},
	]);

	return observations;
}

async function observe_handler_control({
	playwright,
	target,
}: ApplicationDriver): Promise<HandlerControlObservation> {
	const request = await make_request_context(playwright, target);
	const redirect = await request.get("/control/redirect", { maxRedirects: 0 });
	const error = await request.get("/control/error");
	const observation = {
		error_body: await error.text(),
		error_status: error.status(),
		redirect_location: redirect.headers()["location"] ?? "missing",
		redirect_status: redirect.status(),
	};

	expect(observation.redirect_status, `${target.name} redirect status`).toBe(307);
	expect(observation.redirect_location, `${target.name} redirect location`).toBe("/redirected");
	expect(observation.error_status, `${target.name} error status`).toBe(418);
	expect(observation.error_body, `${target.name} error body`).toContain("teapot");
	await request.dispose();

	return observation;
}

async function observe_live_finalization({
	browser,
	playwright,
	target,
}: ApplicationDriver): Promise<LiveFinalizationObservation> {
	const request = await make_request_context(playwright, target);
	let context: BrowserContext | undefined;
	let context_open = false;

	try {
		context = await browser.newContext({
			baseURL: target.url,
			ignoreHTTPSErrors: true,
		});
		context_open = true;

		const page = await context.newPage();

		await request.delete("/api/lifecycle");
		await page.goto("/lifecycle", { waitUntil: "commit" });
		await expect(page.getByTestId("lifecycle")).toHaveText("connected");
		await expect
			.poll(async () => has_active_lifecycle(await read_lifecycle_events(request)), {
				message: `${target.name} stream must start`,
			})
			.toBe(true);

		const before_close = await read_lifecycle_events(request);
		const finalizations_before_close = count_lifecycle_event(before_close, "finalized");

		await context.close();
		context_open = false;

		try {
			await expect
				.poll(
					async () =>
						count_lifecycle_event(await read_lifecycle_events(request), "finalized"),
					{
						message: `${target.name} stream must finalize`,
						timeout: 5_000,
					},
				)
				.toBeGreaterThan(finalizations_before_close);
		} catch (error: unknown) {
			if (target.name === "native") {
				throw error;
			}
		}

		const after_close = await read_lifecycle_events(request);
		const finalizations_after_close = count_lifecycle_event(after_close, "finalized");

		return {
			active_before_close: has_active_lifecycle(before_close),
			finalized_after_close: finalizations_after_close > finalizations_before_close,
		};
	} finally {
		const close_context = context_open
			? (context?.close() ?? Promise.resolve())
			: Promise.resolve();

		await Promise.all([close_context, request.dispose()]);
	}
}

function has_active_lifecycle(events: ReadonlyArray<string>): boolean {
	const starts = count_lifecycle_event(events, "started");
	const finalizations = count_lifecycle_event(events, "finalized");

	return starts > finalizations;
}

function count_lifecycle_event(events: ReadonlyArray<string>, event: string): number {
	return events.filter((entry) => entry === event).length;
}

async function assert_native_parity<Value>(
	scenario: Scenario<ApplicationDriver, Value>,
	driver: Omit<ApplicationDriver, "target">,
	test_info: TestInfo,
	deviations: Partial<Record<TargetName, Readonly<Record<string, string>>>> = {},
): Promise<void> {
	const observations: Observation<Value>[] = [];

	for (const target of targets) {
		const value = await scenario.drive({ ...driver, target });
		const run_id = `playwright-${test_info.project.name}`;
		const observation = normalize_observation({
			scenario_id: scenario.id,
			target: target.name,
			value,
			recorded_at: new Date().toISOString(),
		});
		const evidence = make_evidence(
			".dist/conformance/evidence",
			run_id,
			scenario.id,
			target.name,
			"drive",
			"observation.json",
			{
				browser: test_info.project.name,
				target_url: target.url,
			},
		);
		const payload = {
			capability: scenario.capability,
			evidence,
			observation,
			promise: scenario.promise,
			regression: scenario.regression,
		};

		observations.push(observation);
		await attach_json_evidence(
			test_info,
			`${scenario.id}-${target.name}-evidence`,
			evidence.path,
			payload,
		);
	}

	const native = get_observation(observations, "native");

	for (const { name: target } of targets.filter(({ name }) => name !== "native")) {
		const comparison = compare_observations(native, get_observation(observations, target));
		const documented = deviations[target] ?? {};
		const evidence = make_evidence(
			".dist/conformance/evidence",
			`playwright-${test_info.project.name}`,
			scenario.id,
			target,
			"compare",
			"comparison.json",
			{ browser: test_info.project.name, oracle: "native" },
		);
		const unexpected = comparison.differences.filter(
			(difference) => !is_documented_difference(difference.path, documented),
		);
		const stale = Object.keys(documented).filter(
			(documented_path) =>
				!comparison.differences.some((difference) =>
					is_documented_difference(difference.path, {
						[documented_path]: documented[documented_path] ?? "",
					}),
				),
		);

		await attach_json_evidence(
			test_info,
			`${scenario.id}-${target}-comparison`,
			evidence.path,
			{ comparison, deviations: documented, evidence },
		);
		expect(unexpected, `${target} must match native for ${scenario.id}`).toEqual([]);
		expect(stale, `${target} deviations must describe observed evidence`).toEqual([]);
	}
}

async function observe_query_behavior({
	browser,
	playwright,
	target,
}: ApplicationDriver): Promise<QueryObservation> {
	const request = await make_request_context(playwright, target);
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
		extraHTTPHeaders: { "x-request-id": "query" },
	});
	const page = await context.newPage();
	const traffic_recorder = await capture_remote_traffic(page);
	const traffic = traffic_recorder.traffic;

	await request.put("/api/gates/query");
	await open_hydrated_page(page, "/query");
	await expect(page.getByTestId("cache")).toHaveText(/^cache:\d+$/);

	const initial_cache = read_trailing_number(await page.getByTestId("cache").innerText());

	await page.getByTestId("cache-refresh").click();
	await expect(page.getByTestId("cache")).toHaveText(`cache:${initial_cache + 1}`);

	const cache_state = await page.getByTestId("cache-state").innerText();

	await page.getByTestId("query-failure-button").click();
	await expect(page.getByTestId("query-failure")).toHaveText("409:query:http:conflict");
	await expect(page.getByTestId("query-error-property")).toHaveText("409:query:http:conflict");

	await page.getByTestId("slow-query").click();
	await wait_for_gate(request, "query");

	const slow_loading = await page.getByTestId("slow-loading").innerText();

	expect(slow_loading).toBe("true");
	await request.post("/api/gates/query");
	await expect(page.getByTestId("slow-result")).toHaveText("slow:alpha");
	await expect(page.getByTestId("slow-loading")).toHaveText("false");

	const observation = {
		build_snapshot: await page.getByTestId("prerender-build").innerText(),
		cache_delta:
			read_trailing_number(await page.getByTestId("cache").innerText()) - initial_cache,
		cache_state,
		failure: await page.getByTestId("query-failure").innerText(),
		failure_property: await page.getByTestId("query-error-property").innerText(),
		runtime_snapshot: await page.getByTestId("prerender-runtime").innerText(),
		slow_loading,
		slow_result: await page.getByTestId("slow-result").innerText(),
		traffic,
	} satisfies QueryObservation;

	await context.close();
	await traffic_recorder.stop();
	await request.dispose();

	return observation;
}

async function observe_command_behavior({
	browser,
	playwright,
	target,
}: ApplicationDriver): Promise<CommandObservation> {
	const request = await make_request_context(playwright, target);
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
		extraHTTPHeaders: { "x-request-id": "command" },
	});
	const page = await context.newPage();
	const traffic_recorder = await capture_remote_traffic(page);
	const traffic = traffic_recorder.traffic;

	await request.put("/api/gates/command");
	await open_hydrated_page(page, "/command");

	const initial_mutation = Number(await page.getByTestId("mutation").innerText());

	await page.getByTestId("mutate").click();
	await expect
		.poll(() => page.getByTestId("command-result").innerText(), { timeout: 5_000 })
		.not.toBe("idle")
		.catch(() => undefined);
	await expect
		.poll(() => page.getByTestId("mutation").innerText(), { timeout: 2_000 })
		.toBe(String(initial_mutation + 1))
		.catch(() => undefined);

	const mutation_result = await page.getByTestId("command-result").innerText();

	await page.getByTestId("slow-command").click();
	await wait_for_gate(request, "command");

	const pending_during_request = await page.getByTestId("command-pending").innerText();

	await request.post("/api/gates/command");
	await expect(page.getByTestId("command-result")).toHaveText("command:released");
	await expect(page.getByTestId("command-pending")).toHaveText("0");

	await page.getByTestId("fail-command").click();
	await expect(page.getByTestId("command-failure")).toHaveText("409:command:conflict");
	await page.getByTestId("redirect-command").click();
	await expect(page.getByTestId("command-redirect")).not.toHaveText("idle");

	const final_mutation = Number(await page.getByTestId("mutation").innerText());
	const observation = {
		failure: await page.getByTestId("command-failure").innerText(),
		mutation_delta: final_mutation - initial_mutation,
		pending_during_request,
		redirect: await page.getByTestId("command-redirect").innerText(),
		result: mutation_result,
		slow_result: "command:released",
		traffic,
	} satisfies CommandObservation;

	await context.close();
	await traffic_recorder.stop();
	await request.dispose();

	return observation;
}

async function observe_transport_boundary({
	browser,
	target,
}: ApplicationDriver): Promise<TransportBoundaryObservation> {
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
		extraHTTPHeaders: { "x-request-id": "transport" },
	});
	const page = await context.newPage();

	await open_hydrated_page(page, "/command");

	const failure_response = page.waitForResponse((response) =>
		response.url().includes("/FailCommand"),
	);

	await page.getByTestId("fail-command").click();
	await expect(page.getByTestId("command-failure")).toHaveText("409:command:conflict");

	const valid_response = await failure_response;
	const endpoint = new URL(valid_response.url());
	const malformed = await context.request.fetch(valid_response.url(), {
		data: "{",
		headers: {
			"content-type": "application/json",
			origin: target.url,
		},
		method: "POST",
	});
	const malformed_body = await malformed.text();
	const malformed_content_type = malformed.headers()["content-type"] ?? "none";
	const observation = {
		malformed_body_kind: malformed_content_type.includes("application/json")
			? "json"
			: malformed_content_type.includes("text/html")
				? "html"
				: "other",
		malformed_exposes_internals: /SyntaxError|node:internal|\n\s+at\s/.test(malformed_body),
		malformed_status: malformed.status(),
		method: valid_response.request().method(),
		path: endpoint.pathname,
		typed_failure: await page.getByTestId("command-failure").innerText(),
	} satisfies TransportBoundaryObservation;

	await context.close();

	return observation;
}

async function observe_transformed_form({
	browser,
	playwright,
	target,
}: ApplicationDriver): Promise<FormObservation> {
	const request = await make_request_context(playwright, target);
	const traffic: RemoteTraffic[] = [];
	const open_form = async () => {
		const context = await browser.newContext({
			baseURL: target.url,
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();
		const traffic_recorder = await capture_remote_traffic(page, traffic);

		await open_hydrated_page(page, "/forms");

		return { context, page, traffic_recorder };
	};

	const invalid = await open_form();

	await invalid.page.getByTestId("transformed-amount").fill("not-a-number");
	await invalid.page.getByTestId("transformed-label").fill("rejected");
	await invalid.page.getByTestId("transformed-submit").click();
	await expect(invalid.page.getByTestId("transformed-amount-issue")).not.toHaveText("valid");

	const invalid_issue = await invalid.page.getByTestId("transformed-amount-issue").innerText();

	await invalid.context.close();
	await invalid.traffic_recorder.stop();

	const success = await open_form();

	await success.page.getByTestId("transformed-amount").fill("7");
	await success.page.getByTestId("transformed-label").fill("saved");
	await success.page.getByTestId("transformed-submit").click();
	await expect(success.page.getByTestId("transformed-result")).toHaveText(
		/transformed:7:saved:\s*number/,
	);
	await expect(success.page.getByTestId("transformed-lifecycle")).toHaveText("true:0");

	const result = (await success.page.getByTestId("transformed-result").innerText()).replaceAll(
		/\s+/g,
		"",
	);
	const result_lifecycle = await success.page.getByTestId("transformed-lifecycle").innerText();
	const reset_amount = await success.page.getByTestId("transformed-amount").inputValue();
	const reset_label = await success.page.getByTestId("transformed-label").inputValue();

	await success.context.close();
	await success.traffic_recorder.stop();

	await request.put("/api/gates/form");

	const pending = await open_form();

	await pending.page.getByTestId("transformed-amount").fill("8");
	await pending.page.getByTestId("transformed-label").fill("slow");
	await pending.page.getByTestId("transformed-submit").click();
	await wait_for_gate(request, "form");

	const pending_during_request = await pending.page
		.getByTestId("transformed-lifecycle")
		.innerText();

	expect(pending_during_request).toMatch(/^(true|false):1$/);
	await request.post("/api/gates/form");
	await expect(pending.page.getByTestId("transformed-result")).toHaveText(
		/transformed:8:slow:\s*number/,
	);

	const slow_result = (
		await pending.page.getByTestId("transformed-result").innerText()
	).replaceAll(/\s+/g, "");

	await pending.context.close();
	await pending.traffic_recorder.stop();

	const redirected = await open_form();

	await redirected.page.getByTestId("transformed-amount").fill("9");
	await redirected.page.getByTestId("transformed-label").fill("redirect");
	await redirected.page.getByTestId("transformed-submit").click();
	await expect(redirected.page).toHaveURL(/\/redirected\?source=form$/);

	const redirect_url = new URL(redirected.page.url());
	const redirect_path = `${redirect_url.pathname}${redirect_url.search}`;

	await redirected.context.close();
	await redirected.traffic_recorder.stop();
	await request.dispose();

	return {
		invalid_issue,
		pending_during_request,
		redirect_path,
		reset_amount,
		reset_label,
		result,
		result_lifecycle,
		slow_result,
		traffic,
	};
}

async function observe_request_interruption({
	browser,
	playwright,
	target,
}: ApplicationDriver): Promise<InterruptionObservation> {
	let observation: InterruptionObservation = { events: [] };

	for (const _attempt of [1, 2]) {
		observation = await observe_request_interruption_attempt({ browser, playwright, target });

		if (observation.events.includes("finalized")) {
			return observation;
		}
	}

	return observation;
}

async function observe_request_interruption_attempt({
	browser,
	playwright,
	target,
}: ApplicationDriver): Promise<InterruptionObservation> {
	const request = await make_request_context(playwright, target);
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
	});
	const page = await context.newPage();

	await request.delete("/api/interrupt/events");
	await page.goto("/redirected", { waitUntil: "commit" });
	await page.evaluate(() => {
		const state = globalThis as typeof globalThis & {
			__ser_abort_controller?: AbortController;
		};

		state.__ser_abort_controller = new AbortController();
		void fetch("/api/interrupt", {
			signal: state.__ser_abort_controller.signal,
		}).catch(() => undefined);
	});
	await expect
		.poll(() => read_interrupt_events(request), {
			message: `${target.name} request Effect must start`,
		})
		.toContain("started");
	await page.evaluate(() => {
		const state = globalThis as typeof globalThis & {
			__ser_abort_controller?: AbortController;
		};

		state.__ser_abort_controller?.abort();
	});
	await expect
		.poll(() => read_interrupt_events(request), {
			message: `${target.name} request Effect must finalize`,
			timeout: 5_000,
		})
		.toContain("finalized")
		.catch(() => undefined);

	const events = await read_interrupt_events(request);

	await context.close();
	await request.dispose();

	return { events };
}

async function observe_live_query({
	browser,
	playwright,
	target,
}: ApplicationDriver): Promise<LiveObservation> {
	const request = await make_request_context(playwright, target);
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
	});
	const page = await context.newPage();
	const traffic_recorder = await capture_remote_traffic(page);
	const traffic = traffic_recorder.traffic;

	await request.delete("/api/live-state");

	const response = await page
		.goto("/live", { waitUntil: "commit", timeout: 5_000 })
		.catch(() => undefined);

	if (!response || response.status() !== 200) {
		const availability = response ? `http:${response.status()}` : "timeout";

		await context.close();
		await traffic_recorder.stop();
		await request.dispose();

		return make_unavailable_live_observation(availability, traffic);
	}

	await expect(page.getByTestId("live-left")).toHaveText("shared:1");
	await expect(page.getByTestId("live-right")).toHaveText("shared:1");
	await expect(page.getByTestId("live-left-status")).toHaveText("Open");
	await expect(page.getByTestId("live-right-status")).toHaveText("Open");

	const initial_state = await wait_for_live_state(
		request,
		(state) => state.ready && state.starts > 0 && state.starts - state.finalizations === 1,
	);

	await request.post("/api/live-state", { data: { value: 2 } });
	await expect(page.getByTestId("live-left")).toHaveText("shared:2");
	await expect(page.getByTestId("live-right")).toHaveText("shared:2");
	await page.getByTestId("live-reconnect").click();

	const reconnected_state = await wait_for_live_state(
		request,
		(state) => state.ready && state.starts > initial_state.starts,
	);

	await request.post("/api/live-state", { data: { value: 3 } });
	await expect(page.getByTestId("live-left")).toHaveText("shared:3");
	await expect(page.getByTestId("live-right")).toHaveText("shared:3");

	const observation = {
		availability: "ready",
		done: [
			await page.getByTestId("live-left-done").innerText(),
			await page.getByTestId("live-right-done").innerText(),
		],
		initial_active_connections: initial_state.starts - initial_state.finalizations,
		initial_finalizations: initial_state.finalizations,
		initial_starts: initial_state.starts,
		reconnect_active_connections: reconnected_state.starts - reconnected_state.finalizations,
		reconnect_start_delta: reconnected_state.starts - initial_state.starts,
		status: [
			await page.getByTestId("live-left-status").innerText(),
			await page.getByTestId("live-right-status").innerText(),
		],
		traffic,
		update: [
			await page.getByTestId("live-left").innerText(),
			await page.getByTestId("live-right").innerText(),
		],
	} satisfies LiveObservation;

	await context.close();
	await traffic_recorder.stop();
	await request.dispose();

	return observation;
}

function make_unavailable_live_observation(
	availability: string,
	traffic: ReadonlyArray<RemoteTraffic>,
): LiveObservation {
	return {
		availability,
		done: ["unavailable", "unavailable"],
		initial_active_connections: -1,
		initial_finalizations: -1,
		initial_starts: -1,
		reconnect_active_connections: -1,
		reconnect_start_delta: -1,
		status: ["unavailable", "unavailable"],
		traffic,
		update: ["unavailable", "unavailable"],
	};
}

async function observe_prerender({
	playwright,
	target,
}: ApplicationDriver): Promise<PrerenderObservation> {
	const request = await make_request_context(playwright, target);
	const response = await request.get("/prerender", { failOnStatusCode: false });
	const body = await response.text();
	const observation = {
		outcome: body.includes("snapshot:ready") ? "snapshot:ready" : "internal-error",
		status: response.status(),
	};

	await request.dispose();

	return observation;
}

async function observe_handler_contracts({
	browser,
	target,
}: ApplicationDriver): Promise<HandlerObservation> {
	const context = await browser.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
		extraHTTPHeaders: { "x-request-id": "handler" },
	});
	const page = await context.newPage();
	const traffic_recorder = await capture_remote_traffic(page);
	const traffic = traffic_recorder.traffic;

	await open_hydrated_page(page, "/handler/alpha");

	const load = {
		event_param: await page.getByTestId("handler-event-param").innerText(),
		event_request: await page.getByTestId("handler-event-request").innerText(),
		parameter: await page.getByTestId("handler-param").innerText(),
		request_id: await page.getByTestId("handler-request-id").innerText(),
		route: await page.getByTestId("handler-route").innerText(),
	};

	expect(load).toEqual({
		event_param: "alpha",
		event_request: "handler",
		parameter: "alpha",
		request_id: "handler",
		route: "/handler/[id]",
	});

	await page.getByTestId("handler-success").click();
	await expect(page.getByTestId("handler-result")).toHaveText("handled:alpha:oracle");

	const action = {
		event_param: await page.getByTestId("handler-action-param").innerText(),
		event_request: await page.getByTestId("handler-action-event-request").innerText(),
		method: await page.getByTestId("handler-action-method").innerText(),
		request_id: await page.getByTestId("handler-action-request").innerText(),
		result: await page.getByTestId("handler-result").innerText(),
		route: await page.getByTestId("handler-action-route").innerText(),
	};

	expect(action).toEqual({
		event_param: "alpha",
		event_request: "handler",
		method: "POST",
		request_id: "handler",
		result: "handled:alpha:oracle",
		route: "/handler/[id]",
	});

	const failure_request = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" && response.url().includes("?/failure"),
	);

	await page.getByTestId("handler-failure").click();

	const failure = await failure_request;
	const failure_body = await failure.text();

	expect(failure.status()).toBe(409);
	expect(failure_body).toContain("handler:alpha:conflict");

	const failure_status = failure.status();

	await context.close();
	await traffic_recorder.stop();

	return {
		action,
		failure_body: normalize_handler_failure_body(failure_body),
		failure_status,
		load,
		traffic,
	};
}

async function attach_json_evidence(
	test_info: TestInfo,
	name: string,
	path: string,
	value: unknown,
): Promise<void> {
	const body = JSON.stringify(value, null, 2);

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${body}\n`, "utf8");
	await test_info.attach(name, { path, contentType: "application/json" });
}

async function capture_remote_traffic(
	page: Page,
	traffic: RemoteTraffic[] = [],
): Promise<RemoteTrafficRecorder> {
	const browser_name = page.context().browser()?.browserType().name();
	const body_tasks = new Set<Promise<void>>();
	const protocol_tasks = new Set<Promise<void>>();
	const stream_records: Array<{
		chunks: number;
		method: string;
		path: string;
		payload: string[];
		request_id: string;
	}> = [];
	const stream_records_by_id = new Map<string, (typeof stream_records)[number]>();
	const session =
		browser_name === "chromium" ? await page.context().newCDPSession(page) : undefined;

	if (session) {
		await session.send("Network.enable");
		session.on("Network.requestWillBeSent", (event) => {
			if (!is_remote_url(event.request.url)) {
				return;
			}

			const url = new URL(event.request.url);
			const record = {
				chunks: 0,
				method: event.request.method,
				path: url.pathname,
				payload: [] as string[],
				request_id: event.requestId,
			};

			stream_records.push(record);
			stream_records_by_id.set(event.requestId, record);
		});
		session.on("Network.responseReceived", (event) => {
			const record = stream_records_by_id.get(event.requestId);

			if (!record) {
				return;
			}

			const task = session
				.send("Network.streamResourceContent", { requestId: event.requestId })
				.then(({ bufferedData }) => {
					if (bufferedData) {
						record.chunks += 1;
						record.payload.push(Buffer.from(bufferedData, "base64").toString("utf8"));
					}
				})
				.catch(() => undefined)
				.then(() => undefined);

			protocol_tasks.add(task);
			void task.finally(() => protocol_tasks.delete(task));
		});
		session.on("Network.dataReceived", (event) => {
			const record = stream_records_by_id.get(event.requestId);

			if (record && event.data) {
				record.chunks += 1;
				record.payload.push(Buffer.from(event.data, "base64").toString("utf8"));
			}
		});
	}

	page.on("response", (response) => {
		const url = new URL(response.url());

		if (!is_remote_url(response.url())) {
			return;
		}

		const entry: MutableRemoteTraffic = {
			method: response.request().method(),
			path: url.pathname,
			request_content_type: response.request().headers()["content-type"] ?? "none",
			request_cookie: "cookie" in response.request().headers(),
			request_id: response.request().headers()["x-request-id"] ?? "none",
			request_payload: response.request().postData() ?? "",
			request_payload_bytes: response.request().postDataBuffer()?.byteLength ?? 0,
			response_body: "pending",
			response_content_type: response.headers()["content-type"] ?? "none",
			response_location: response.headers()["location"] ?? "none",
			response_payload_bytes: 0,
			response_set_cookie: "set-cookie" in response.headers(),
			response_stream_payload: "",
			response_streamed: false,
			status: response.status(),
		};
		const body_task = response
			.body()
			.then((body) => {
				entry.response_body = body.toString("utf8");
				entry.response_payload_bytes = body.byteLength;
			})
			.catch(() => {
				entry.response_body = "unavailable-while-stream-open";
			})
			.then(() => undefined);

		traffic.push(entry);
		body_tasks.add(body_task);
		void body_task.finally(() => body_tasks.delete(body_task));
	});

	return {
		traffic,
		stop: async () => {
			await Promise.allSettled([...body_tasks, ...protocol_tasks]);

			const used_records = new Set<string>();

			for (const entry of traffic as MutableRemoteTraffic[]) {
				const record = stream_records.find(
					(candidate) =>
						!used_records.has(candidate.request_id) &&
						candidate.method === entry.method &&
						candidate.path === entry.path,
				);

				if (!record) {
					continue;
				}

				const stream_payload = record.payload.join("");

				used_records.add(record.request_id);
				entry.response_stream_payload = stream_payload;
				entry.response_streamed =
					record.chunks > 1 || entry.response_content_type.includes("text/event-stream");
			}

			await session?.detach().catch(() => undefined);
		},
	};
}

function is_remote_url(value: string): boolean {
	const url = new URL(value);

	return url.pathname.includes("/_app/remote") || url.searchParams.has("/remote");
}

async function make_request_context(
	playwright: Playwright,
	target: TargetEndpoint,
): Promise<APIRequestContext> {
	return playwright.request.newContext({
		baseURL: target.url,
		ignoreHTTPSErrors: true,
	});
}

async function wait_for_gate(request: APIRequestContext, name: string): Promise<void> {
	await expect
		.poll(async () => {
			const response = await request.get(`/api/gates/${name}`);

			return (await response.json()) as { released: boolean; waiting: number };
		})
		.toEqual({ released: false, waiting: 1 });
}

async function wait_for_live_state(
	request: APIRequestContext,
	accept: (state: {
		finalizations: number;
		ready: boolean;
		starts: number;
		value: number;
		waiters: number;
	}) => boolean,
): Promise<{
	finalizations: number;
	ready: boolean;
	starts: number;
	value: number;
	waiters: number;
}> {
	let observed = { finalizations: 0, ready: false, starts: 0, value: 0, waiters: 0 };

	await expect
		.poll(async () => {
			const response = await request.get("/api/live-state");

			observed = (await response.json()) as typeof observed;

			return accept(observed);
		})
		.toBe(true);

	return observed;
}

function normalize_handler_failure_body(body: string): string {
	return body.includes("handler:alpha:conflict") ? "handler:alpha:conflict" : body;
}

function is_documented_difference(
	path: string,
	documented: Readonly<Record<string, string>>,
): boolean {
	return Object.keys(documented).some(
		(documented_path) =>
			path === documented_path ||
			path.startsWith(`${documented_path}.`) ||
			path.startsWith(`${documented_path}[`),
	);
}

function read_trailing_number(value: string): number {
	const match = value.match(/(\d+)$/);

	if (!match) {
		throw new Error(`Expected a trailing number in ${value}.`);
	}

	return Number(match[1]);
}

function get_observation<Value>(
	observations: ReadonlyArray<Observation<Value>>,
	target: TargetName,
): Observation<Value> {
	const observation = observations.find((candidate) => candidate.target === target);

	if (!observation) {
		throw new Error(`Missing ${target} observation.`);
	}

	return observation;
}

async function read_lifecycle_events(request: APIRequestContext): Promise<string[]> {
	const response = await request.get("/api/lifecycle");

	return (await response.json()) as string[];
}

async function read_interrupt_events(request: APIRequestContext): Promise<string[]> {
	const response = await request.get("/api/interrupt/events");

	return (await response.json()) as string[];
}
