<script lang="ts">
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

	const profile_resource = GetProfile({ id: "alpha" });
	const deduped_first = GetDeduped("same");
	const deduped_second = GetDeduped("same");
	const batched_first = GetBatched("alpha");
	const batched_second = GetBatched("beta");
	const live_resource = GetLive();
	const serialized_resource = GetSerialized();
	const snapshot_resource = GetSnapshot();

	let command_result = $state("idle");
	let profile = $state(await profile_resource);
	let signal_count = $state(1);

	CreateItem.enhance(async ({ submit }) => {
		await submit().updates();
	});

	async function refresh_profile() {
		profile = await profile_resource.refresh();
	}

	async function run_command() {
		command_result = await Increment(1);
	}
</script>

{#snippet rendered(value)}
	<p data-testid="render">{value}</p>
{/snippet}

<svelte:head>
	<title>SER conformance native</title>
</svelte:head>

<main>
	<h1>Native SvelteKit oracle</h1>
	<p data-testid="profile">{profile.message}:{profile.runtime}</p>
	<p data-testid="request">{profile.request_id}:{profile.session}</p>
	<p data-testid="dedupe">
		{(await deduped_first).invocation}:{(await deduped_second).invocation}
	</p>
	<p data-testid="batch">{await batched_first}|{await batched_second}</p>
	<p data-testid="live">{await live_resource}</p>
	<p data-testid="snapshot">{await snapshot_resource}</p>
	<p data-testid="serialized">
		{(await serialized_resource).date instanceof Date}:
		{(await serialized_resource).map instanceof Map}:
		{(await serialized_resource).set instanceof Set}:
		{(await serialized_resource).bytes instanceof Uint8Array}:
		{String((await serialized_resource).bigint)}
	</p>
	<p data-testid="command">{command_result}</p>
	<button data-testid="refresh" onclick={refresh_profile}>Refresh query</button>
	<button data-testid="command-button" onclick={run_command}>Run command</button>

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

	<p data-testid="markup">{await Promise.resolve("markup:ready")}</p>
	{#if await Promise.resolve(true)}
		<p data-testid="if">if:ready</p>
	{/if}
	<ul data-testid="each">
		{#each await Promise.resolve(["a", "b"]) as item}
			<li>{item}</li>
		{/each}
	</ul>
	{#await Promise.resolve("await:ready") then value}
		<p data-testid="await">{value}</p>
	{/await}
	{#key await Promise.resolve(signal_count)}
		<p data-testid="key">key:{signal_count}</p>
	{/key}
	{#if true}
		{@const declared = await Promise.resolve("declaration:ready")}
		<p data-testid="declaration">{declared}</p>
	{/if}
	{@html await Promise.resolve('<strong data-testid="html">html:ready</strong>')}
	{@render rendered(await Promise.resolve("render:ready"))}
	<button data-testid="signal" onclick={() => (signal_count += 1)}>Signal {signal_count}</button>
</main>
