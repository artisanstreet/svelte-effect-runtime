<script lang="ts">
	import { create_post } from "$lib/posts.remote";
	import { ping_server } from "$lib/pings.remote";

	function describe(target: object, key: PropertyKey) {
		const d = Object.getOwnPropertyDescriptor(target, key);
		if (!d) return "missing";
		return JSON.stringify({
			configurable: d.configurable ?? null,
			enumerable: d.enumerable ?? null,
			writable: "writable" in d ? d.writable ?? null : null,
			has_getter: typeof d.get === "function",
			value_kind: "value" in d ? typeof d.value : "(accessor)"
		});
	}

	function symbol_summary(target: object) {
		return Object.getOwnPropertySymbols(target).map((symbol) => ({
			description: symbol.description,
			enumerable:
				Object.getOwnPropertyDescriptor(target, symbol)?.enumerable ?? false
		}));
	}
</script>

<h1>Descriptor diagnostics</h1>
<p>
	Live inspection of the wrapped <code>EffectForm</code>. After the 1.5.0+
	spread fix, these descriptors should match what SvelteKit's native
	<code>form()</code> emits — same enumerable keys, same getters preserved,
	same attachment Symbol shape.
</p>

<section>
	<h2>create_post (Form with schema)</h2>
	<dl>
		<dt><code>Object.keys</code></dt>
		<dd><code>{JSON.stringify(Object.keys(create_post))}</code></dd>

		<dt><code>typeof create_post.submit</code></dt>
		<dd><code>{typeof create_post.submit}</code></dd>

		<dt><code>typeof create_post.for</code></dt>
		<dd><code>{typeof create_post.for}</code></dd>

		<dt>method descriptor</dt>
		<dd><code>{describe(create_post, "method")}</code></dd>

		<dt>action descriptor</dt>
		<dd><code>{describe(create_post, "action")}</code></dd>

		<dt>fields descriptor</dt>
		<dd><code>{describe(create_post, "fields")}</code></dd>

		<dt>result descriptor</dt>
		<dd><code>{describe(create_post, "result")}</code></dd>

		<dt>pending descriptor</dt>
		<dd><code>{describe(create_post, "pending")}</code></dd>

		<dt>submit descriptor</dt>
		<dd><code>{describe(create_post, "submit")}</code></dd>

		<dt>native descriptor</dt>
		<dd><code>{describe(create_post, "native")}</code></dd>

		<dt>symbols</dt>
		<dd><code>{JSON.stringify(symbol_summary(create_post))}</code></dd>
	</dl>
</section>

<section>
	<h2>ping_server (no-input Form)</h2>
	<dl>
		<dt><code>Object.keys</code></dt>
		<dd><code>{JSON.stringify(Object.keys(ping_server))}</code></dd>

		<dt>method descriptor</dt>
		<dd><code>{describe(ping_server, "method")}</code></dd>

		<dt>action descriptor</dt>
		<dd><code>{describe(ping_server, "action")}</code></dd>

		<dt>symbols</dt>
		<dd><code>{JSON.stringify(symbol_summary(ping_server))}</code></dd>
	</dl>
</section>

<section>
	<h2>create_post.for("xyz") (cloned sub-form)</h2>
	{#await Promise.resolve(create_post.for("xyz")) then sub}
		<dl>
			<dt><code>Object.keys</code></dt>
			<dd><code>{JSON.stringify(Object.keys(sub))}</code></dd>

			<dt>action descriptor (should include /xyz)</dt>
			<dd><code>{describe(sub, "action")}</code></dd>

			<dt><code>typeof sub.submit</code></dt>
			<dd><code>{typeof sub.submit}</code></dd>
		</dl>
	{/await}
</section>

<style>
	section {
		margin: 1.5rem 0;
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 1rem;
	}
	dl {
		display: grid;
		grid-template-columns: 14rem 1fr;
		gap: 0.35rem 1rem;
		margin: 0;
		font-size: 0.85em;
	}
	dt {
		color: #555;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	code {
		background: #f4f4f4;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
	}
</style>
