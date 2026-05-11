<script lang="ts">
	import { page } from "$app/state";
	import { NAV } from "$lib/nav";

	let { children } = $props();
</script>

<div class="shell">
	<aside>
		<a href="/" class="brand">
			<strong>SER Examples</strong>
			<small>svelte-effect-runtime 1.6.0</small>
		</a>

		<nav>
			{#each NAV as group}
				<section>
					<h3>{group.title}</h3>
					<ul>
						{#each group.links as link}
							<li>
								<a
									href={link.href}
									class:active={page.url.pathname === link.href}
								>
									{link.label}
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</nav>

		<footer>
			<small>
				<code>svelte-effect-runtime@1.6.0</code> from npm
			</small>
		</footer>
	</aside>

	<main>
		{@render children()}
	</main>
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		font-family: system-ui, sans-serif;
		line-height: 1.5;
		background: #fafafa;
		color: #1c1c1c;
	}
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}
	:global(button) {
		cursor: pointer;
		padding: 0.5rem 0.9rem;
		border: 1px solid #888;
		border-radius: 4px;
		background: #fff;
		font: inherit;
	}
	:global(button:hover) {
		background: #f0f0f0;
	}
	:global(code) {
		background: #f0f0f0;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
		font-size: 0.9em;
	}
	.shell {
		display: grid;
		grid-template-columns: 260px 1fr;
		min-height: 100vh;
	}
	aside {
		position: sticky;
		top: 0;
		height: 100vh;
		overflow-y: auto;
		border-right: 1px solid #e0e0e0;
		background: #fff;
		padding: 1rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.brand {
		display: block;
		text-decoration: none;
		color: inherit;
		padding: 0.5rem;
		border-radius: 6px;
	}
	.brand:hover {
		background: #f4f4f4;
	}
	.brand strong {
		display: block;
		font-size: 1.05em;
	}
	.brand small {
		color: #777;
		font-size: 0.8em;
	}
	nav {
		flex: 1;
	}
	nav section {
		margin-bottom: 1rem;
	}
	nav h3 {
		margin: 0 0 0.35rem 0.5rem;
		text-transform: uppercase;
		font-size: 0.72em;
		letter-spacing: 0.06em;
		color: #888;
	}
	nav ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	nav a {
		display: block;
		padding: 0.35rem 0.5rem;
		border-radius: 4px;
		text-decoration: none;
		color: #333;
		font-size: 0.92em;
	}
	nav a:hover {
		background: #f1f1f1;
	}
	nav a.active {
		background: #1c1c1c;
		color: #fff;
	}
	footer {
		border-top: 1px solid #eee;
		padding-top: 0.5rem;
		color: #888;
	}
	footer small {
		font-size: 0.78em;
	}
	main {
		padding: 1.5rem 2rem;
		max-width: 900px;
	}
	:global(main h1) {
		margin-top: 0;
	}
</style>
