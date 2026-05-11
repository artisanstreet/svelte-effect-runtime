<script lang="ts">
	import { Effect } from "effect";
	import { create_post } from "$lib/posts.remote";

	let title = $state("enhanced post");
	let body = $state("submitted through a custom enhance callback");
	let lifecycle = $state<string[]>([]);
	let confirmed = $state(false);

	function log(step: string) {
		lifecycle = [...lifecycle, `${new Date().toLocaleTimeString()} — ${step}`];
	}
</script>

<h1>Custom <code>.enhance(callback)</code></h1>
<p>
	As of 1.6.0, <code>EffectForm.enhance</code> is Effect-shaped: the callback
	receives <code>submit</code> as a thunk returning
	<code>Effect&lt;void, RemoteFailure&lt;Error&gt;, never&gt;</code>, and may
	itself return an Effect (which the runtime will run for you) or
	<code>void</code>. No more <code>async</code>/<code>await</code> mixing
	with the rest of your Effect code.
</p>

<form
	{...create_post.enhance(({ data, submit }) =>
		Effect.gen(function* () {
			log(`enhance start with ${JSON.stringify(data)}`);
			if (!confirmed) {
				log("blocked: not confirmed");
				return;
			}

			const outcome = yield* submit().pipe(
				Effect.matchCause({
					onSuccess: () => "submit resolved",
					onFailure: (cause) => `submit failed: ${cause.toString()}`
				})
			);
			log(outcome);
		})
	)}
>
	<label>
		Title
		<input {...create_post.fields.title.as("text")} bind:value={title} />
	</label>
	<label>
		Body
		<textarea {...create_post.fields.body.as("text")} bind:value={body}
		></textarea>
	</label>
	<label class="checkbox">
		<input type="checkbox" bind:checked={confirmed} />
		I confirm I want to publish
	</label>
	<button type="submit">Publish (enhanced)</button>
</form>

<h2>Lifecycle</h2>
<ol>
	{#each lifecycle as entry}
		<li><code>{entry}</code></li>
	{/each}
</ol>

{#if create_post.result}
	<pre>result: {JSON.stringify(create_post.result, null, 2)}</pre>
{/if}

<style>
	label {
		display: block;
		margin: 0.5rem 0;
	}
	label.checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	input,
	textarea {
		width: 100%;
		padding: 0.4rem;
		box-sizing: border-box;
	}
	input[type="checkbox"] {
		width: auto;
	}
	ol {
		background: #fafafa;
		border: 1px solid #ddd;
		border-radius: 4px;
		padding: 0.5rem 1.5rem;
	}
	pre {
		background: #f4f4f4;
		padding: 0.75rem;
		border-radius: 4px;
	}
</style>
