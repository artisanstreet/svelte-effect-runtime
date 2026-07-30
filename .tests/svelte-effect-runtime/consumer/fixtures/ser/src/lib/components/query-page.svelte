<script lang="ts" effect>
	import {
		GetQueryFailure,
		GetRefreshable,
		GetSlowQuery,
	} from "$lib/conformance.remote";
	import { Effect } from "effect";
	import { normalize_error } from "$lib/normalize-error";

	import NativePrerenderQuery from "$lib/components/native-prerender-query.svelte";

	const RefreshableResource = GetRefreshable("cache");

	let cache = $state(yield* RefreshableResource);
	let failure = $state("idle");
	let failure_error = $state("none");
	let slow_loading = $state("idle");
	let slow_result = $state("idle");

	const RefreshCache = Effect.gen(function* () {
		yield* RefreshableResource.refresh();
		cache = yield* RefreshableResource;
	});

	const StartSlowQuery = Effect.gen(function* () {
		const SlowResource = GetSlowQuery("alpha");

		slow_loading = String(SlowResource.loading);
		slow_result = yield* SlowResource;
		slow_loading = String(SlowResource.loading);
	});

	const StartFailingQuery = Effect.gen(function* () {
		const FailureResource = GetQueryFailure("http");

		failure = "pending";
		failure = yield* FailureResource.pipe(
			Effect.matchEffect({
				onFailure: NormalizeError,
				onSuccess: () =>
					Effect.gen(function* () {
						return "unexpected-success";
					}),
			}),
		);
		failure_error = yield* NormalizeError(FailureResource.error);
	});

	const NormalizeError = (error: unknown) => normalize_error(error);
</script>

<p data-testid="cache">{cache.key}:{cache.invocation}</p>
<p data-testid="cache-state">
	{RefreshableResource.ready}:{RefreshableResource.loading}:{RefreshableResource.current?.invocation}
</p>
<button data-testid="cache-refresh" onclick={yield* RefreshCache}>Refresh cache</button>

<p data-testid="slow-loading">{slow_loading}</p>
<p data-testid="slow-result">{slow_result}</p>
<button data-testid="slow-query" onclick={yield* StartSlowQuery}>Start slow query</button>

<p data-testid="query-failure">{failure}</p>
<p data-testid="query-error-property">{failure_error}</p>
<button data-testid="query-failure-button" onclick={yield* StartFailingQuery}>Fail query</button>

<NativePrerenderQuery />
