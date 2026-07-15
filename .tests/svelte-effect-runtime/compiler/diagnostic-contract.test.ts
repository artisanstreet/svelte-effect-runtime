import { effect } from "svelte-effect-runtime/compiler";
import { expect, test } from "vitest";

test("invalid event callback syntax reports a stable source-positioned diagnostic", async () => {
	const source = [
		`<script lang="ts">`,
		`\timport { Effect } from "effect";`,
		`</script>`,
		``,
		`<button onclick={() => yield* Effect.succeed("saved")}>save</button>`,
	].join("\n");
	const diagnostics = effect().find(
		(plugin) => plugin.name === "svelte-effect-runtime:diagnostics",
	);
	const warnings: unknown[] = [];

	if (!diagnostics || typeof diagnostics.transform !== "function") {
		throw new Error("SER diagnostics plugin should expose a transform hook");
	}

	await diagnostics.transform.call(
		{
			warn(warning: unknown) {
				warnings.push(warning);
			},
		} as never,
		source,
		"src/routes/+page.svelte",
	);

	expect(warnings).toEqual([
		{
			id: "src/routes/+page.svelte",
			loc: {
				column: 16,
				line: 5,
			},
			message: [
				"[svelte-effect-runtime] Detected yield* hidden inside an event callback.",
				`src/routes/+page.svelte: onclick={() => yield* Effect.succeed("saved")}`,
				"SER can only lower yield* at the event attribute boundary.",
				"Write the event expression directly, for example: onclick={yield* save()}",
			].join("\n"),
		},
	]);
});

test("tokenless yield callbacks report the same positioned diagnostic", async () => {
	const source = [
		`<script lang="ts">`,
		`\tconst save = () => undefined;`,
		`</script>`,
		``,
		`<button onclick={() => yield* save()}>save</button>`,
	].join("\n");
	const diagnostics = effect().find(
		(plugin) => plugin.name === "svelte-effect-runtime:diagnostics",
	);
	const warnings: unknown[] = [];

	if (!diagnostics || typeof diagnostics.transform !== "function") {
		throw new Error("SER diagnostics plugin should expose a transform hook");
	}

	await diagnostics.transform.call(
		{
			warn(warning: unknown) {
				warnings.push(warning);
			},
		} as never,
		source,
		"src/routes/+page.svelte",
	);

	expect(warnings).toEqual([
		{
			id: "src/routes/+page.svelte",
			loc: {
				column: 16,
				line: 5,
			},
			message: [
				"[svelte-effect-runtime] Detected yield* hidden inside an event callback.",
				`src/routes/+page.svelte: onclick={() => yield* save()}`,
				"SER can only lower yield* at the event attribute boundary.",
				"Write the event expression directly, for example: onclick={yield* save()}",
			].join("\n"),
		},
	]);
});
