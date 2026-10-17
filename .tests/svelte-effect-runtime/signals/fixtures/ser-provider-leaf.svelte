<script lang="ts" effect>
	import { Punctuated } from "./services.ts";
</script>

<output data-testid="punctuated">{(yield* Punctuated).text}</output>
