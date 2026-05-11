<script lang="ts">
	import { toggle_todo, delete_todo } from "$lib/todos.remote";

	const todos = [
		{ id: 1, label: "buy milk" },
		{ id: 2, label: "ship spread fix" },
		{ id: 3, label: "write more smokes" }
	];
</script>

<h1><code>.for(id)</code> in <code>{`{#each}`}</code></h1>
<p>
	Each row uses <code>toggle_todo.for(todo.id)</code> and
	<code>delete_todo.for(todo.id)</code> to produce isolated form instances
	with distinct action URLs. The key passed to <code>.for()</code> is merged
	into the submitted data as the <code>id</code> field, so the handler
	receives <code>{`{ id, done? }`}</code> without you wiring up a hidden
	input by hand.
</p>
<p>
	Watch the live state under each row — <code>pending</code> ticks during a
	submission, <code>result</code> appears on success, and per-field
	<code>issues()</code> show any validation failure.
</p>

<ul>
	{#each todos as todo (todo.id)}
		{@const toggle = toggle_todo.for(todo.id)}
		{@const remove = delete_todo.for(todo.id)}
		<li>
			<div class="row">
				<form {...toggle} class="inline">
					<label class="check">
						<input type="checkbox" name="done" />
						done
					</label>
					<button type="submit" disabled={toggle.pending > 0}>
						{toggle.pending > 0 ? "saving…" : "save"}
					</button>
				</form>

				<span class="label">#{todo.id} — {todo.label}</span>

				<form {...remove} class="inline">
					<button type="submit" disabled={remove.pending > 0}>
						{remove.pending > 0 ? "deleting…" : "delete"}
					</button>
				</form>
			</div>

			<div class="meta">
				<div>
					toggle action: <code>{toggle.action}</code>
				</div>
				<div>
					delete action: <code>{remove.action}</code>
				</div>
			</div>

			{#if toggle.result}
				<pre class="ok">toggle.result = {JSON.stringify(toggle.result, null, 2)}</pre>
			{/if}
			{#if remove.result}
				<pre class="ok">delete.result = {JSON.stringify(remove.result, null, 2)}</pre>
			{/if}

			{#if toggle.fields.allIssues()?.length}
				<pre class="err">toggle issues = {JSON.stringify(
						toggle.fields.allIssues(),
						null,
						2
					)}</pre>
			{/if}
			{#if remove.fields.allIssues()?.length}
				<pre class="err">delete issues = {JSON.stringify(
						remove.fields.allIssues(),
						null,
						2
					)}</pre>
			{/if}
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
		margin-bottom: 0.75rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.inline {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
	}
	.label {
		flex: 1;
	}
	.check {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		font-size: 0.9em;
	}
	.meta {
		font-size: 0.8em;
		color: #666;
		margin-top: 0.5rem;
		overflow-wrap: anywhere;
	}
	pre {
		padding: 0.5rem;
		border-radius: 4px;
		font-size: 0.85em;
		margin: 0.5rem 0 0;
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
