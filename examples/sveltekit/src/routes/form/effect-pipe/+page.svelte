<script lang="ts" effect>
	import { Effect } from "effect";
	import { create_post } from "$lib/posts.remote";

	let title = $state("piped post");
	let body = $state("a piped body that's long enough");

	let outcome = $state<string>("");
	let last_status = $state<"idle" | "success" | "failure">("idle");
</script>

<h1>
	<code>submit().pipe(Effect.matchCause)</code>
</h1>
<p>
	<code>create_post.submit(data)</code> returns
	<code>Effect&lt;Output, RemoteFailure&lt;Error&gt;, never&gt;</code> — every
	Effect operator (<code>matchCause</code>, <code>catchTag</code>,
	<code>tap</code>, <code>flatMap</code>, etc.) works directly on the result.
</p>

<label>
	Title <input type="text" bind:value={title} />
</label>
<label>
	Body <textarea bind:value={body}></textarea>
</label>

<button
	onclick={() => {
		outcome = yield* create_post.submit({ title, body }).pipe(
			Effect.tap((post) =>
				Effect.sync(() => {
					last_status = "success";
					console.log("piped success", post);
				})
			),
			Effect.matchCause({
				onSuccess: (post) => Effect.succeed(`slug: ${post.slug}`),
				onFailure: (cause) =>
					Effect.sync(() => {
						last_status = "failure";
						return `failed: ${cause.toString()}`;
					})
			})
		);
	}}
>
	Submit (piped)
</button>

<p>
	last status: <strong>{last_status}</strong>
</p>
{#if outcome}
	<pre>{outcome}</pre>
{/if}

<style>
	label {
		display: block;
		margin: 0.5rem 0;
	}
	input,
	textarea {
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
