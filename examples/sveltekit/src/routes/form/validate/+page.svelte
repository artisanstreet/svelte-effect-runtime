<script lang="ts" effect>
	import { Effect } from "effect";
	import { create_post } from "$lib/posts.remote";

	let last_validation = $state<string>("");
</script>

<h1>Programmatic <code>validate()</code></h1>
<p>
	As of 1.6.0, <code>EffectForm.validate</code> returns
	<code>Effect&lt;void, RemoteFailure&lt;Error&gt;, never&gt;</code>. Yield
	it to run validation against the server-side schema without committing a
	submission — useful for live "is this valid?" checks while the user types,
	without the verbosity of <code>async</code>/<code>await</code>.
</p>

<form {...create_post}>
	<label>
		Title
		<input {...create_post.fields.title.as("text")} />
	</label>
	<label>
		Body
		<textarea {...create_post.fields.body.as("text")}></textarea>
	</label>

	<div class="actions">
		<button type="submit">Submit normally</button>
		<button
			type="button"
			onclick={() => {
				yield* create_post.validate();
				last_validation = new Date().toLocaleTimeString();
			}}
		>
			Validate only
		</button>
		<button
			type="button"
			onclick={() => {
				yield* create_post.validate({ includeUntouched: true });
				last_validation = `${new Date().toLocaleTimeString()} (incl. untouched)`;
			}}
		>
			Validate (incl. untouched)
		</button>
	</div>
</form>

{#if last_validation}
	<p>last validate run: <strong>{last_validation}</strong></p>
{/if}

{#if create_post.fields.allIssues()?.length}
	<pre class="err">{JSON.stringify(
			create_post.fields.allIssues(),
			null,
			2
		)}</pre>
{/if}

{#if create_post.result}
	<pre class="ok">{JSON.stringify(create_post.result, null, 2)}</pre>
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
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	pre {
		padding: 0.75rem;
		border-radius: 4px;
		margin-top: 0.75rem;
	}
	pre.ok {
		background: #effaef;
		border: 1px solid #b8dcb8;
	}
	pre.err {
		background: #fbecec;
		border: 1px solid #dca8a8;
	}
</style>
