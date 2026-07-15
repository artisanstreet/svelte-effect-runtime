<script lang="ts">
	import type { PageProps } from "./$types";

	import HandlerPage from "$lib/components/handler-page.svelte";

	let { data, form }: PageProps = $props();
</script>

<HandlerPage {data} {form} />
