<script lang="ts" effect>
	import {
		CreateItem,
		GetBatched,
		GetDeduped,
		GetLive,
		GetProfile,
		GetSerialized,
		GetSnapshot,
		Increment,
	} from "$lib/conformance.remote";
	import { Effect } from "effect";

	const ProfileResource = GetProfile({ id: "alpha" });
	const DedupedFirst = GetDeduped("same");
	const DedupedSecond = GetDeduped("same");
	const BatchedFirst = GetBatched("alpha");
	const BatchedSecond = GetBatched("beta");
	const LiveResource = GetLive();
	const SerializedResource = GetSerialized();
	const SnapshotResource = GetSnapshot();
	const SnapshotEffect = Effect.isEffect(SnapshotResource)
		? SnapshotResource
		: Effect.promise(() => Promise.resolve(SnapshotResource));

	let command_result = $state("idle");
	let profile = $state(yield* ProfileResource);
	let signal_count = $state(yield* Effect.succeed(1));

	const deduped_first = yield* DedupedFirst;
	const deduped_second = yield* DedupedSecond;
	const batched_first = yield* BatchedFirst;
	const batched_second = yield* BatchedSecond;
	const live_value = yield* LiveResource;
	const serialized = yield* SerializedResource;
	const snapshot = yield* SnapshotEffect;

	CreateItem.enhance(({ submit }) =>
		Effect.gen(function* () {
			yield* submit().updates();
		}),
	);

	const RefreshProfile = Effect.gen(function* () {
		profile = yield* ProfileResource.refresh();
	});

	const RunCommand = Effect.gen(function* () {
		command_result = yield* Increment(1);
	});

	const AdvanceSignal = Effect.gen(function* () {
		signal_count = yield* Effect.succeed(signal_count + 1);
	});
</script>

<svelte:head>
	<title>SER conformance runtime</title>
</svelte:head>

<main>
	<h1>Svelte Effect Runtime target</h1>
	<p data-testid="profile">{profile.message}:{profile.runtime}</p>
	<p data-testid="request">{profile.request_id}:{profile.session}</p>
	<p data-testid="dedupe">{deduped_first.invocation}:{deduped_second.invocation}</p>
	<p data-testid="batch">{batched_first}|{batched_second}</p>
	<p data-testid="live">{live_value}</p>
	<p data-testid="snapshot">{snapshot}</p>
	<p data-testid="serialized">
		{serialized.date instanceof Date}:
		{serialized.map instanceof Map}:
		{serialized.set instanceof Set}:
		{serialized.bytes instanceof Uint8Array}:
		{String(serialized.bigint)}
	</p>
	<p data-testid="command">{command_result}</p>
	<button data-testid="refresh" onclick={yield* RefreshProfile}>Refresh query</button>
	<button data-testid="command-button" onclick={yield* RunCommand}>Run command</button>

	<form {...CreateItem}>
		<input data-testid="name" {...CreateItem.fields.name.as("text")} />
		<input data-testid="label" {...CreateItem.fields.items[0].label.as("text")} />
		<button data-testid="form-submit">Save item</button>
	</form>
	<p data-testid="form-result">{CreateItem.result?.message ?? "idle"}</p>
	<p data-testid="form-lifecycle">{CreateItem.submitted}:{CreateItem.pending}</p>
	<p data-testid="form-issue">
		{CreateItem.fields.items[0].label.issues()?.[0]?.message ?? "valid"}
	</p>
	<p data-testid="form-all-issues">{JSON.stringify(CreateItem.fields.allIssues() ?? [])}</p>

	<p data-testid="markup">{yield* Effect.succeed("markup:ready")}</p>
	{#if yield* Effect.succeed(true)}
		<p data-testid="if">if:ready</p>
	{/if}
	<ul data-testid="each">
		{#each yield* Effect.succeed(["a", "b"]) as item}
			<li>{item}</li>
		{/each}
	</ul>
	{#await yield* Effect.succeed("await:ready") then value}
		<p data-testid="await">{value}</p>
	{/await}
	{#key yield* Effect.succeed(signal_count)}
		<p data-testid="key">key:{signal_count}</p>
	{/key}
	{#if true}
		{@const declared = yield* Effect.succeed("declaration:ready")}
		<p data-testid="declaration">{declared}</p>
	{/if}
	{@html yield* Effect.succeed('<strong data-testid="html">html:ready</strong>')}
	<button data-testid="signal" onclick={yield* AdvanceSignal}>Signal {signal_count}</button>
</main>
