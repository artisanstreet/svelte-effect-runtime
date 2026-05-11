<script lang="ts">
	import { NAV } from "$lib/nav";

	const total = NAV.reduce((sum, group) => sum + group.links.length, 0);
</script>

<h1>svelte-effect-runtime — examples</h1>
<p>
	A running gallery of {total} examples across the four remote-function kinds
	exposed by SER:
	<code>Form</code>, <code>Query</code>, <code>Command</code>, and
	<code>Prerender</code>. Pick a group from the sidebar — every example is a
	separate route, so the URL pins what you're looking at.
</p>

<p>
	This app installs SER from a local tarball
	(<code>svelte-effect-runtime-1.5.0.tgz</code>, the build that ships the
	form-spread fix). You can edit the example pages live with
	<code>npm run dev</code>; remote handlers live in
	<code>src/lib/*.remote.ts</code>.
</p>

<h2>Groups</h2>

<dl>
	{#each NAV as group}
		<dt>{group.title}</dt>
		<dd>{group.description} <small>({group.links.length} examples)</small></dd>
	{/each}
</dl>

<style>
	dl {
		display: grid;
		grid-template-columns: 7rem 1fr;
		gap: 0.4rem 1rem;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	small {
		color: #888;
	}
</style>
