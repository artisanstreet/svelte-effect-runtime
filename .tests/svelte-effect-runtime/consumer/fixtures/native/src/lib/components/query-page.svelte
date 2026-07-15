<script lang="ts">
	import {
		GetQueryFailure,
		GetRefreshable,
		GetSlowQuery,
	} from "$lib/conformance.remote";
	import { GetDynamicSnapshot } from "$lib/prerender.remote";

	const refreshable_resource = GetRefreshable("cache");
	const build_snapshot = GetDynamicSnapshot("static");
	const dynamic_snapshot = GetDynamicSnapshot("runtime");

	let cache = $state(await refreshable_resource);
	let failure = $state("idle");
	let failure_error = $state("none");
	let slow_loading = $state("idle");
	let slow_result = $state("idle");

	async function refresh_cache() {
		await refreshable_resource.refresh();
		cache = await refreshable_resource;
	}

	async function start_slow_query() {
		const resource = GetSlowQuery("alpha");

		slow_loading = String(resource.loading);
		slow_result = await resource;
		slow_loading = String(resource.loading);
	}

	async function start_failing_query() {
		const resource = GetQueryFailure("http");

		failure = "pending";

		try {
			await resource;
		} catch (error: unknown) {
			failure = normalize_error(error);
			failure_error = normalize_error(resource.error);
		}
	}

	function normalize_error(error: unknown): string {
		if (!error || typeof error !== "object") {
			return String(error);
		}

		const value = error as {
			body?: { message?: string };
			message?: string;
			status?: number;
		};

		return `${value.status ?? 0}:${value.body?.message ?? value.message ?? "unknown"}`;
	}
</script>

<p data-testid="cache">{cache.key}:{cache.invocation}</p>
<p data-testid="cache-state">
	{refreshable_resource.ready}:{refreshable_resource.loading}:{refreshable_resource.current?.invocation}
</p>
<button data-testid="cache-refresh" onclick={refresh_cache}>Refresh cache</button>

<p data-testid="slow-loading">{slow_loading}</p>
<p data-testid="slow-result">{slow_result}</p>
<button data-testid="slow-query" onclick={start_slow_query}>Start slow query</button>

<p data-testid="query-failure">{failure}</p>
<p data-testid="query-error-property">{failure_error}</p>
<button data-testid="query-failure-button" onclick={start_failing_query}>Fail query</button>

<p data-testid="prerender-build">{await build_snapshot}</p>
<p data-testid="prerender-runtime">{await dynamic_snapshot}</p>
