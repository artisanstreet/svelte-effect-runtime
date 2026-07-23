<script effect lang="ts">
	import { SER_PUBLIC_ORIGIN } from "$ser/env/public";

	const public_origin = yield* SER_PUBLIC_ORIGIN;
</script>

<p data-environment-public-origin>{public_origin.href}</p>
