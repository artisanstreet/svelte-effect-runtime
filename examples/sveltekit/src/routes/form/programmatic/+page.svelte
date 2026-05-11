<script lang="ts" effect>
	import { create_post } from "$lib/posts.remote";

	let title = $state("programmatic post");
	let body = $state("submitted without a form element");
	let last_slug = $state<string>("");
	let last_error = $state<string>("");
</script>

<h1>Programmatic <code>.submit()</code></h1>
<p>
	No <code>&lt;form&gt;</code> element on the page. The runtime detects no
	attached form and falls back to a hidden temp form to deliver the request.
	Useful when the form lives entirely in script (e.g. wizards, modals,
	keyboard shortcuts).
</p>

<label>
	Title <input type="text" bind:value={title} />
</label>
<label>
	Body <textarea bind:value={body}></textarea>
</label>

<button
	onclick={() => {
		last_error = "";
		try {
			const post = yield* create_post.submit({ title, body });
			last_slug = post.slug;
		} catch (cause) {
			last_error = String(cause);
		}
	}}
>
	Submit programmatically
</button>

{#if last_slug}
	<p>slug: <code>{last_slug}</code></p>
{/if}
{#if last_error}
	<p style="color: crimson">error: {last_error}</p>
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
</style>
