<script lang="ts" effect>
	import { Effect } from "effect";
	import { get_post } from "$lib/queries.remote";

	let slug = $state("alpha");
	let result = $state<{ slug: string; title: string; body: string } | null>(
		null
	);
	let error = $state<string>("");

	// Prime with the initial slug.
	result = yield* get_post(slug);
</script>

<h1>Query — Schema-validated input</h1>
<p>
	<code>get_post</code> validates the argument with
	<code>Schema.String</code>. Unknown slugs produce a tagged
	<code>PostNotFound</code> failure — recoverable on the client via
	<code>Effect.catchTag("PostNotFound", ...)</code>.
</p>

<label>
	Slug
	<input bind:value={slug} placeholder="alpha | beta | gamma" />
</label>
<button
	onclick={() => {
		error = "";
		result = yield* get_post(slug).pipe(
			Effect.catchTag("PostNotFound", (err) => {
				error = `no post for slug "${err.slug}"`;
				return Effect.succeed(null);
			}),
			Effect.catchAll((err) => {
				error = `other remote error: ${JSON.stringify(err)}`;
				return Effect.succeed(null);
			})
		);
	}}
>
	Look up
</button>

{#if result}
	<pre>{JSON.stringify(result, null, 2)}</pre>
{/if}
{#if error}
	<p style="color: crimson">{error}</p>
{/if}

<style>
	label {
		display: block;
		margin: 0.5rem 0;
	}
	input {
		width: 100%;
		padding: 0.4rem;
		box-sizing: border-box;
	}
	pre {
		background: #f4f4f4;
		padding: 0.75rem;
		border-radius: 4px;
	}
</style>
