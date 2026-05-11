<script lang="ts">
	import { echo_unchecked } from "$lib/pings.remote";
</script>

<h1><code>Form("unchecked", ...)</code></h1>
<p>
	When the first argument is the literal <code>"unchecked"</code>, schema
	validation is skipped and the handler receives the raw parsed FormData. Use
	this for ad-hoc forms where you don't want to declare a schema, and accept
	that the input type is whatever your fields produce.
</p>

<form {...echo_unchecked}>
	<input type="text" name="username" placeholder="username" />
	<input type="email" name="email" placeholder="email" />
	<input type="text" name="tags[]" placeholder="tag #1" />
	<input type="text" name="tags[]" placeholder="tag #2" />
	<button type="submit">Echo</button>
</form>

{#if echo_unchecked.result}
	<h2>Echoed</h2>
	<pre>{JSON.stringify(echo_unchecked.result, null, 2)}</pre>
{/if}

<style>
	form {
		display: grid;
		gap: 0.5rem;
		max-width: 360px;
	}
	input {
		padding: 0.4rem;
	}
	pre {
		background: #f4f4f4;
		padding: 0.75rem;
		border-radius: 4px;
	}
</style>
