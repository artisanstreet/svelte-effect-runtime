<script lang="ts" effect>
	import { dev } from "$app/environment";
	import { get_topic } from "$lib/prerender.remote";

	// In dev mode, prerender remote functions are not evaluated unless the
	// route is actually prerendered into a build artefact. The values come
	// back as undefined. Guard the access so the page still renders.
	const intro = yield* get_topic("intro");
	const guide = yield* get_topic("guide");
</script>

<h1>Prerender — static at build time</h1>
<p>
	<code>Prerender(Schema, fn, &#123; inputs &#125;)</code> declares an
	Effect whose result is captured at build time. The client doesn't re-fetch
	on subsequent loads — it replays the prerendered payload.
</p>

{#if dev}
	<div class="notice">
		⚠️ In <code>npm run dev</code>, non-dynamic prerender results aren't
		populated. Run <code>npm run build &amp;&amp; npm run preview</code> and
		open this page from the preview server to see real prerendered output.
	</div>
{/if}

{#if intro}
	<article>
		<h2>{intro.title} <small>({intro.slug})</small></h2>
		<p>{intro.body}</p>
	</article>
{/if}

{#if guide}
	<article>
		<h2>{guide.title} <small>({guide.slug})</small></h2>
		<p>{guide.body}</p>
	</article>
{/if}

<style>
	article {
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 0.75rem;
		margin-bottom: 0.75rem;
	}
	small {
		color: #888;
		font-weight: normal;
	}
	.notice {
		background: #fff7d6;
		border: 1px solid #e6c75a;
		padding: 0.75rem;
		border-radius: 6px;
		margin-bottom: 1rem;
	}
</style>
