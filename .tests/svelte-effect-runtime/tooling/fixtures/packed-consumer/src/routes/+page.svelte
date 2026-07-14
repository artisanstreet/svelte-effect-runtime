<script lang="ts" effect>
	import { Effect } from "effect";
	import { GetLabel } from "./label.remote.ts";

	const ScriptLabel = Effect.gen(function* () {
		yield* Effect.void;

		return "packed script";
	});
</script>

<h1>{yield* GetLabel()}</h1>
<p>{yield* ScriptLabel}</p>
