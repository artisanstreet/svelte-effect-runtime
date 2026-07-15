<script lang="ts">
	import HandlerPage from "$lib/components/handler-page.svelte";
	import type { PageProps } from "./$types";

	let { data, form }: PageProps = $props();
</script>

<HandlerPage {data} {form} />
