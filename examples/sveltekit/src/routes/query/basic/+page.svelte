<script lang="ts" effect>
	import { get_all_posts } from "$lib/queries.remote";

	const posts = yield* get_all_posts();
</script>

<h1>Query — no-arg</h1>
<p>
	<code>get_all_posts()</code> is a void-input <code>Query</code>. Yielding
	it inside the <code>effect</code> script block runs the Effect and resolves
	to the server's result.
</p>

<ul>
	{#each posts as post}
		<li>
			<strong>{post.title}</strong>
			<span>({post.slug})</span>
			<p>{post.body}</p>
		</li>
	{/each}
</ul>

<style>
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 0.75rem;
		margin-bottom: 0.5rem;
	}
	li p {
		margin: 0.25rem 0 0;
		color: #555;
	}
</style>
