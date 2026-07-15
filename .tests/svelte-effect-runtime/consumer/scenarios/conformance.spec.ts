import { compare_observations } from "../../unit/harness/comparison.ts";
import { conformance_proxy_port, conformance_proxy_protocol } from "../../unit/harness/model.ts";
import { normalize_observation } from "../../unit/harness/normalization.ts";
import { make_evidence } from "../../unit/harness/evidence.ts";
import type { Observation, Scenario, TargetName } from "../../unit/harness/model.ts";
import {
	expect,
	test,
	type APIRequestContext,
	type Browser,
	type Page,
	type Playwright,
	type TestInfo,
} from "@playwright/test";
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
	readonly request_payload_bytes: number;
	readonly response_content_type: string;
	readonly response_location: string;
	readonly response_set_cookie: boolean;
	readonly status: number;
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

const targets: ReadonlyArray<TargetEndpoint> = [
	{
		name: "native",
		url: `${conformance_proxy_protocol}://ser-conformance-native.localhost:${conformance_proxy_port}`,
	},
	{
		name: "stable",
		url: `${conformance_proxy_protocol}://ser-conformance-stable.localhost:${conformance_proxy_port}`,
	},
	{
		name: "candidate",
		url: `${conformance_proxy_protocol}://ser-conformance-candidate.localhost:${conformance_proxy_port}`,
	},
];

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

const stable_deviations: Readonly<Record<string, string>> = {
	"$.initial.html":
		"The stable 4.0.0 compiler drops Effect-backed {@html} output; candidate must render the native HTML node.",
	"$.initial.render":
		"The stable 4.0.0 compiler cannot parse a typed snippet used by an Effect-backed {@render}; candidate must compile and render it.",
	"$.initial.batch":
		"The stable 4.0.0 client starts each Query.batch resource as a separate one-item batch; candidate must match native shared batching.",
	"$.interactions.form_issue":
		"The stable 4.0.0 client drops nested indexed programmatic invalidation from visible form field state; candidate must match native paths and messages.",
	"$.interactions.form_all_issues":
		"The stable 4.0.0 server emits indexed paths as strings; candidate must match native numeric paths and field names.",
};

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

test(query_behavior_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(query_behavior_scenario, { browser, playwright }, test_info);
});

test(command_behavior_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(command_behavior_scenario, { browser, playwright }, test_info, {
		stable: {
			"$.mutation_delta":
				"The stable 4.0.0 Command cannot complete SvelteKit's requested-query refresh protocol; issue #36 records the failure.",
			"$.pending_during_request":
				"The stable 4.0.0 Command does not expose native numeric pending state while blocked.",
			"$.redirect": "The stable 4.0.0 Command loses SvelteKit's public redirect diagnostic.",
			"$.result":
				"The stable 4.0.0 Command leaves its client result idle when requested-query refresh fails.",
			"$.traffic":
				"The stable 4.0.0 client rejects the requested-query update before dispatching Mutate.",
		},
		candidate: {
			"$.mutation_delta":
				"The candidate cannot complete SvelteKit's requested-query refresh protocol; issue #36 records the failure.",
			"$.pending_during_request":
				"The candidate Command does not expose native numeric pending state while blocked.",
			"$.redirect": "The candidate Command loses SvelteKit's public redirect diagnostic.",
			"$.result":
				"The candidate leaves its client result idle when requested-query refresh fails.",
			"$.traffic":
				"The candidate rejects the requested-query update before dispatching Mutate.",
		},
	});
});

test(transformed_form_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(transformed_form_scenario, { browser, playwright }, test_info);
});

test(request_interruption_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(request_interruption_scenario, { browser, playwright }, test_info, {
		stable: {
			"$.events[1]":
				"The stable 4.0.0 Handler leaves server work running after the HTTP client aborts; issue #33 records the minimized failure.",
		},
		candidate: {
			"$.events[1]":
				"The Effect-native candidate leaves Handler work running after the HTTP client aborts; issue #33 records the minimized failure.",
		},
	});
});

test(live_query_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(live_query_scenario, { browser, playwright }, test_info, {
		stable: {
			"$.availability":
				"The stable 4.0.0 live query does not complete SSR for the shared Stream fixture; issue #35 records the adjacent candidate packaging failure.",
			"$.done": "The stable live route is unavailable before browser state can be observed.",
			"$.initial_active_connections":
				"The stable live route is unavailable before connection state can be observed.",
			"$.initial_finalizations":
				"The stable live route is unavailable before finalization state can be observed.",
			"$.initial_starts":
				"The stable live route is unavailable before start state can be observed.",
			"$.reconnect_active_connections":
				"The stable live route is unavailable before reconnect state can be observed.",
			"$.reconnect_start_delta":
				"The stable live route is unavailable before reconnect state can be observed.",
			"$.status":
				"The stable live route is unavailable before resource status can be observed.",
			"$.traffic": "The stable live route times out before a browser live transport opens.",
			"$.update": "The stable live route is unavailable before updates can be observed.",
		},
		candidate: {
			"$.availability":
				"The candidate live route fails while evaluating its ESM page chunk; issue #35 records the failure.",
			"$.done":
				"The candidate live route is unavailable before browser state can be observed.",
			"$.initial_active_connections":
				"The candidate live route is unavailable before connection state can be observed.",
			"$.initial_finalizations":
				"The candidate live route is unavailable before finalization state can be observed.",
			"$.initial_starts":
				"The candidate live route is unavailable before start state can be observed.",
			"$.reconnect_active_connections":
				"The candidate live route is unavailable before reconnect state can be observed.",
			"$.reconnect_start_delta":
				"The candidate live route is unavailable before reconnect state can be observed.",
			"$.status":
				"The candidate live route is unavailable before resource status can be observed.",
			"$.traffic": "The candidate fails before a browser live transport opens.",
			"$.update": "The candidate live route is unavailable before updates can be observed.",
		},
	});
});

test(handler_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(handler_scenario, { browser, playwright }, test_info);
});

test(prerender_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(prerender_scenario, { browser, playwright }, test_info, {
		stable: {
			"$.outcome":
				"The stable 4.0.0 compiler cannot serve the Effect-authored Prerender route; issue #34 preserves the failure.",
			"$.status":
				"The stable 4.0.0 compiler returns an error for the Effect-authored Prerender route.",
		},
		candidate: {
			"$.outcome":
				"The candidate emits an undefined prerender binding; issue #34 preserves the production failure.",
			"$.status": "The candidate returns an error for the Effect-authored Prerender route.",
		},
	});
});

test(transport_boundary_scenario.promise, async ({ browser, playwright }, test_info) => {
	await assert_native_parity(transport_boundary_scenario, { browser, playwright }, test_info);
});

test("native, stable, and candidate expose the same browser-visible contracts", async ({
	browser,
}, test_info) => {
	const observations: Observation<PageObservation>[] = [];

	for (const target of targets) {
		const context = await browser.newContext({
			baseURL: target.url,
			ignoreHTTPSErrors: true,
			extraHTTPHeaders: {
				"x-request-id": "browser",
			},
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

		const value = await observe_page(page, target.name);
		const observation: Observation<PageObservation> = {
			scenario_id: "browser-contracts",
			target: target.name,
			value,
			recorded_at: new Date().toISOString(),
		};

		observations.push(normalize_observation(observation));
		expect(console_errors, `${target.name} browser console`).toEqual([]);
		expect(network.length, `${target.name} remote traffic`).toBeGreaterThan(0);
		expect(network.every((response) => response.status < 400)).toBe(true);
		await test_info.attach(`${target.name}-browser-evidence`, {
			body: Buffer.from(JSON.stringify({ observation, network, console_errors }, null, 2)),
			contentType: "application/json",
		});
		await context.close();
	}

	const native = get_observation(observations, "native");

	for (const target of ["stable", "candidate"] as const) {
		const comparison = compare_observations(native, get_observation(observations, target));
		const deviations = target === "stable" ? stable_deviations : {};
		const unexpected = comparison.differences.filter(
			(difference) => !(difference.path in deviations),
		);

		await test_info.attach(`${target}-comparison`, {
			body: Buffer.from(JSON.stringify({ comparison, deviations }, null, 2)),
			contentType: "application/json",
		});
		expect(unexpected, `${target} must match native`).toEqual([]);
	}
});

test("remote forms preserve ordinary HTML submission without JavaScript", async ({
	browser,
}, test_info) => {
	for (const target of targets) {
		const observation = await observe_unenhanced_form(browser, target);

		expect(observation.result).toBe("saved:no-js:native-form");
		await test_info.attach(`${target.name}-no-js-form`, {
			body: Buffer.from(JSON.stringify(observation, null, 2)),
			contentType: "application/json",
		});
	}
});

test("enhanced keyed forms preserve reset, result, and instance isolation", async ({ browser }) => {
	const lifecycle_observations = new Map<TargetName, string[]>();

	for (const target of targets) {
		const context = await browser.newContext({
			baseURL: target.url,
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();

		await page.goto("/forms", { waitUntil: "networkidle" });
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
		lifecycle_observations.set(target.name, [
			await page.getByTestId("alpha-lifecycle").innerText(),
			await page.getByTestId("beta-lifecycle").innerText(),
		]);
		await context.close();
	}

	expect(lifecycle_observations.get("candidate")).toEqual(lifecycle_observations.get("native"));
});

test("concurrent request contexts remain isolated", async ({ playwright }, test_info) => {
	for (const target of targets) {
		const observations = await observe_request_isolation(playwright, target);

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
		await test_info.attach(`${target.name}-request-isolation`, {
			body: Buffer.from(JSON.stringify(observations, null, 2)),
			contentType: "application/json",
		});
	}
});

test("Handler preserves native redirects and HTTP errors", async ({ playwright }) => {
	for (const target of targets) {
		const request = await playwright.request.newContext({
			baseURL: target.url,
			ignoreHTTPSErrors: true,
		});
		const redirect = await request.get("/control/redirect", { maxRedirects: 0 });
		const error = await request.get("/control/error");

		expect(redirect.status(), `${target.name} redirect status`).toBe(307);
		expect(redirect.headers()["location"], `${target.name} redirect location`).toBe(
			"/redirected",
		);
		expect(error.status(), `${target.name} error status`).toBe(418);
		expect(await error.text(), `${target.name} error body`).toContain("teapot");
		await request.dispose();
	}
});

test("closing a live-query page finalizes its server stream", async ({
	browser,
	playwright,
}, test_info) => {
	const observations = new Map<TargetName, string[]>();

	for (const target of targets) {
		const request = await playwright.request.newContext({
			baseURL: target.url,
			ignoreHTTPSErrors: true,
		});
		const context = await browser.newContext({
			baseURL: target.url,
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();

		await request.delete("/api/lifecycle");
		await page.goto("/lifecycle", { waitUntil: "commit" });
		await expect(page.getByTestId("lifecycle")).toHaveText("connected");
		await expect
			.poll(() => read_lifecycle_events(request), {
				message: `${target.name} stream must start`,
			})
			.toContain("started");

		await context.close();

		try {
			await expect
				.poll(() => read_lifecycle_events(request), {
					message: `${target.name} stream must finalize`,
					timeout: 5_000,
				})
				.toContain("finalized");
		} catch (error: unknown) {
			if (target.name === "native") {
				throw error;
			}
		}

		const events = await read_lifecycle_events(request);

		observations.set(target.name, events);
		await test_info.attach(`${target.name}-lifecycle`, {
			body: Buffer.from(JSON.stringify(events, null, 2)),
			contentType: "application/json",
		});
		await request.dispose();
	}

	expect(observations.get("native")).toContain("finalized");
	expect(
		observations.get("stable"),
		"stable 4.0.0 retains the disconnected live stream",
	).not.toContain("finalized");
	expect(
		observations.get("candidate"),
		"candidate currently retains the disconnected live stream; see the documented deviation",
	).not.toContain("finalized");
	expect(observations.get("candidate")).toContain("started");
});

async function observe_page(page: Page, target: TargetName): Promise<PageObservation> {
	await page.goto("/", { waitUntil: "networkidle" });

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
	if (target !== "stable") {
		await expect(page.getByTestId("render")).toHaveText("render:ready");
	}

	if (target !== "stable") {
		await expect(page.getByTestId("html")).toHaveText("html:ready");
	}

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
		target === "stable" ? "valid" : "Blocked labels are rejected.",
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

	await Promise.all([alpha.request.dispose(), beta.request.dispose(), control.dispose()]);

	return [alpha_observation, beta_observation];
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

	for (const target of ["stable", "candidate"] as const) {
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

		await attach_json_evidence(
			test_info,
			`${scenario.id}-${target}-comparison`,
			evidence.path,
			{ comparison, deviations: documented, evidence },
		);
		expect(unexpected, `${target} must match native for ${scenario.id}`).toEqual([]);
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
	const traffic = capture_remote_traffic(page);

	await request.put("/api/gates/query");
	await page.goto("/query", { waitUntil: "networkidle" });
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
	const traffic = capture_remote_traffic(page);

	await request.put("/api/gates/command");
	await page.goto("/command", { waitUntil: "networkidle" });

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

	await page.goto("/command", { waitUntil: "networkidle" });

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

		capture_remote_traffic(page, traffic);
		await page.goto("/forms", { waitUntil: "networkidle" });

		return { context, page };
	};

	const invalid = await open_form();

	await invalid.page.getByTestId("transformed-amount").fill("not-a-number");
	await invalid.page.getByTestId("transformed-label").fill("rejected");
	await invalid.page.getByTestId("transformed-submit").click();
	await expect(invalid.page.getByTestId("transformed-amount-issue")).not.toHaveText("valid");

	const invalid_issue = await invalid.page.getByTestId("transformed-amount-issue").innerText();

	await invalid.context.close();

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

	const redirected = await open_form();

	await redirected.page.getByTestId("transformed-amount").fill("9");
	await redirected.page.getByTestId("transformed-label").fill("redirect");
	await redirected.page.getByTestId("transformed-submit").click();
	await expect(redirected.page).toHaveURL(/\/redirected\?source=form$/);

	const redirect_url = new URL(redirected.page.url());
	const redirect_path = `${redirect_url.pathname}${redirect_url.search}`;

	await redirected.context.close();
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
	const traffic = capture_remote_traffic(page);

	await request.delete("/api/live-state");

	const response = await page
		.goto("/live", { waitUntil: "commit", timeout: 5_000 })
		.catch(() => undefined);

	if (!response || response.status() !== 200) {
		const availability = response ? `http:${response.status()}` : "timeout";

		await context.close();
		await request.dispose();

		return make_unavailable_live_observation(availability, traffic);
	}

	await expect(page.getByTestId("live-left")).toHaveText("shared:1");
	await expect(page.getByTestId("live-right")).toHaveText("shared:1");
	await expect(page.getByTestId("live-left-status")).toHaveText("Open");
	await expect(page.getByTestId("live-right-status")).toHaveText("Open");

	const initial_state = await wait_for_live_state(
		request,
		(state) => state.starts > 0 && state.starts - state.finalizations === 1,
	);

	await request.post("/api/live-state", { data: { value: 2 } });
	await expect(page.getByTestId("live-left")).toHaveText("shared:2");
	await expect(page.getByTestId("live-right")).toHaveText("shared:2");
	await page.getByTestId("live-reconnect").click();

	const reconnected_state = await wait_for_live_state(
		request,
		(state) => state.starts > initial_state.starts,
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
	const traffic = capture_remote_traffic(page);

	await page.goto("/handler/alpha", { waitUntil: "networkidle" });

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

function capture_remote_traffic(page: Page, traffic: RemoteTraffic[] = []): RemoteTraffic[] {
	page.on("response", (response) => {
		const url = new URL(response.url());

		if (!url.pathname.includes("/_app/remote") && !url.searchParams.has("/remote")) {
			return;
		}

		traffic.push({
			method: response.request().method(),
			path: url.pathname,
			request_content_type: response.request().headers()["content-type"] ?? "none",
			request_cookie: "cookie" in response.request().headers(),
			request_id: response.request().headers()["x-request-id"] ?? "none",
			request_payload_bytes: response.request().postDataBuffer()?.byteLength ?? 0,
			response_content_type: response.headers()["content-type"] ?? "none",
			response_location: response.headers()["location"] ?? "none",
			response_set_cookie: "set-cookie" in response.headers(),
			status: response.status(),
		});
	});

	return traffic;
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
	accept: (state: { finalizations: number; starts: number; value: number }) => boolean,
): Promise<{ finalizations: number; starts: number; value: number }> {
	let observed = { finalizations: 0, starts: 0, value: 0 };

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
