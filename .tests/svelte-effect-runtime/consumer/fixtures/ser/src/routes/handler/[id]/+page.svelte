<script lang="ts">
	import HandlerPage from "$lib/components/handler-page.svelte";

	let { data, form }: PageProps = $props();
</script>

<HandlerPage {data} {form} />
