<script lang="ts" effect>
	import { ping_server } from "$lib/pings.remote";

	let last_pong = $state<string>("");
</script>

<h1>Void-input form</h1>
<p>
	<code>Form(() =&gt; Effect.succeed(...))</code> defines a form whose handler
	takes no arguments. The spread still works — the form just doesn't expose
	any <code>fields</code> for editing.
</p>

<form {...ping_server}>
	<button type="submit">Ping (spread submit)</button>
</form>

<p>or via the Effect:</p>

<button
	onclick={() => {
		const reply = yield* ping_server.submit();
		last_pong = `${reply.message} @ ${reply.at}`;
	}}
>
	Ping (programmatic submit)
</button>

{#if ping_server.result}
	<pre>spread result: {JSON.stringify(ping_server.result, null, 2)}</pre>
{/if}
{#if last_pong}
	<pre>programmatic result: {last_pong}</pre>
{/if}

<style>
	pre {
		background: #f4f4f4;
		padding: 0.75rem;
		border-radius: 4px;
	}
</style>
