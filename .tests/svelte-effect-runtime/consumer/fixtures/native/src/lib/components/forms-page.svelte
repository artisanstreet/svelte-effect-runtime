<script lang="ts">
	import { CreateKeyedItem, CreateTransformedItem } from "$lib/conformance.remote";

	const alpha_form = CreateKeyedItem.for("alpha");
	const beta_form = CreateKeyedItem.for("beta");

	CreateTransformedItem.enhance(async ({ submit }) => {
		await submit().updates();
	});
</script>

<form {...alpha_form} data-testid="alpha-form">
	<input data-testid="alpha-name" {...alpha_form.fields.name.as("text")} />
	<input data-testid="alpha-label" {...alpha_form.fields.label.as("text")} />
	<button data-testid="alpha-submit">Save alpha</button>
</form>
<p data-testid="alpha-result">{alpha_form.result?.message ?? "idle"}</p>
<p data-testid="alpha-lifecycle">{alpha_form.submitted}:{alpha_form.pending}</p>
<p data-testid="alpha-issue">
	{alpha_form.fields.label.issues()?.[0]?.message ?? "valid"}
</p>

<form {...beta_form} data-testid="beta-form">
	<input data-testid="beta-name" {...beta_form.fields.name.as("text")} />
	<input data-testid="beta-label" {...beta_form.fields.label.as("text")} />
	<button data-testid="beta-submit">Save beta</button>
</form>
<p data-testid="beta-result">{beta_form.result?.message ?? "idle"}</p>
<p data-testid="beta-lifecycle">{beta_form.submitted}:{beta_form.pending}</p>
<p data-testid="beta-issue">
	{beta_form.fields.label.issues()?.[0]?.message ?? "valid"}
</p>

<form {...CreateTransformedItem} data-testid="transformed-form">
	<input data-testid="transformed-amount" {...CreateTransformedItem.fields.amount.as("text")} />
	<input data-testid="transformed-label" {...CreateTransformedItem.fields.label.as("text")} />
	<button data-testid="transformed-submit">Save transformed</button>
</form>
<p data-testid="transformed-result">
	{CreateTransformedItem.result?.message ?? "idle"}:
	{CreateTransformedItem.result?.amount_type ?? "unknown"}
</p>
<p data-testid="transformed-lifecycle">
	{CreateTransformedItem.submitted}:{CreateTransformedItem.pending}
</p>
<p data-testid="transformed-amount-issue">
	{CreateTransformedItem.fields.amount.issues()?.[0]?.message ?? "valid"}
</p>
