<script lang="ts">
	import { create_post } from "$lib/posts.remote";

	let title = $state("hello world");
	let body = $state("a short body that meets the minimum length");
</script>

<h1>Basic spread</h1>
<p>
	<code>&lt;form {`{...create_post}`}&gt;</code> sets <code>method="POST"</code>,
	the remote <code>action</code>, and Svelte 5's attachment Symbol — exactly
	matching the shape SvelteKit's native <code>form()</code> emits.
</p>

<form {...create_post}>
	<label>
		Title
		<input {...create_post.fields.title.as("text")} bind:value={title} />
	</label>
	<label>
		Body
		<textarea {...create_post.fields.body.as("text")} bind:value={body}
		></textarea>
	</label>
	<button type="submit" disabled={create_post.pending > 0}>
		{create_post.pending > 0 ? "Submitting…" : "Publish"}
	</button>
</form>

{#if create_post.result}
	<pre>result: {JSON.stringify(create_post.result, null, 2)}</pre>
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
		overflow-x: auto;
	}
</style>
