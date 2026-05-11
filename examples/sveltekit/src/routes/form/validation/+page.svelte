<script lang="ts">
	import { create_post } from "$lib/posts.remote";

	let title = $state("");
	let body = $state("ok");
</script>

<h1>Validation issues</h1>
<p>
	The remote handler yields <code>invalid.title(message)</code> /
	<code>invalid.body(message)</code> when input is bad. The wrapped
	<code>fields</code> proxy surfaces them via <code>issues()</code>, which
	preserves SvelteKit's per-field error API.
</p>

<form {...create_post}>
	<label>
		Title (required, leave blank to trigger error)
		<input {...create_post.fields.title.as("text")} bind:value={title} />
	</label>
	{#if create_post.fields.title.issues()?.[0]}
		<p class="error">
			title: {create_post.fields.title.issues()?.[0].message}
		</p>
	{/if}

	<label>
		Body (must be ≥ 3 chars, default is "ok" which is too short)
		<textarea {...create_post.fields.body.as("text")} bind:value={body}
		></textarea>
	</label>
	{#if create_post.fields.body.issues()?.[0]}
		<p class="error">
			body: {create_post.fields.body.issues()?.[0].message}
		</p>
	{/if}

	<button type="submit">Submit (likely fails)</button>
</form>

<h2>Inspector</h2>
<ul>
	<li>
		<code>fields.title.issues()</code>:
		<code>{JSON.stringify(create_post.fields.title.issues())}</code>
	</li>
	<li>
		<code>fields.body.issues()</code>:
		<code>{JSON.stringify(create_post.fields.body.issues())}</code>
	</li>
	<li>
		<code>fields.allIssues()</code>:
		<code>{JSON.stringify(create_post.fields.allIssues())}</code>
	</li>
</ul>

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
	.error {
		color: crimson;
		margin: 0.25rem 0 0.5rem;
	}
	pre {
		background: #f4f4f4;
		padding: 0.75rem;
		border-radius: 4px;
	}
	ul {
		font-size: 0.9em;
	}
</style>
