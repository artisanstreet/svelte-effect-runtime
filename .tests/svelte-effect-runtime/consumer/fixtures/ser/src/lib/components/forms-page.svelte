<script lang="ts" effect>
	import { CreateKeyedItem, CreateTransformedItem } from "$lib/conformance.remote";
	import { Effect } from "effect";

	const AlphaForm = CreateKeyedItem.for("alpha");
	const BetaForm = CreateKeyedItem.for("beta");

	CreateTransformedItem.enhance(({ submit }) =>
		Effect.gen(function* () {
			yield* submit().updates();
		}),
	);
</script>

<form {...AlphaForm} data-testid="alpha-form">
	<input data-testid="alpha-name" {...AlphaForm.fields.name.as("text")} />
	<input data-testid="alpha-label" {...AlphaForm.fields.label.as("text")} />
	<button data-testid="alpha-submit">Save alpha</button>
</form>
<p data-testid="alpha-result">{AlphaForm.result?.message ?? "idle"}</p>
<p data-testid="alpha-lifecycle">{AlphaForm.submitted}:{AlphaForm.pending}</p>
<p data-testid="alpha-issue">
	{AlphaForm.fields.label.issues()?.[0]?.message ?? "valid"}
</p>

<form {...BetaForm} data-testid="beta-form">
	<input data-testid="beta-name" {...BetaForm.fields.name.as("text")} />
	<input data-testid="beta-label" {...BetaForm.fields.label.as("text")} />
	<button data-testid="beta-submit">Save beta</button>
</form>
<p data-testid="beta-result">{BetaForm.result?.message ?? "idle"}</p>
<p data-testid="beta-lifecycle">{BetaForm.submitted}:{BetaForm.pending}</p>
<p data-testid="beta-issue">
	{BetaForm.fields.label.issues()?.[0]?.message ?? "valid"}
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
