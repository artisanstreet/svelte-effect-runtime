<script lang="ts">
	type HandlerData = {
		readonly event_param: string;
		readonly event_request_id: string;
		readonly id: string;
		readonly request_id: string;
		readonly route_id: string;
	};

	type HandlerForm = {
		readonly event_param?: string;
		readonly event_request_id?: string;
		readonly message?: string;
		readonly method?: string;
		readonly request_id?: string;
		readonly route_id?: string;
	} | null;

	let { data, form }: { data: HandlerData; form: HandlerForm } = $props();
</script>

<p data-testid="handler-param">{data.id}</p>
<p data-testid="handler-event-param">{data.event_param}</p>
<p data-testid="handler-event-request">{data.event_request_id}</p>
<p data-testid="handler-request-id">{data.request_id}</p>
<p data-testid="handler-route">{data.route_id}</p>

<form method="POST" action="?/success">
	<input data-testid="handler-message" name="message" value="oracle" />
	<button data-testid="handler-success">Run successful action</button>
</form>

<form method="POST" action="?/failure">
	<button data-testid="handler-failure">Run failing action</button>
</form>

<p data-testid="handler-result">{form?.message ?? "idle"}</p>
<p data-testid="handler-action-param">{form?.event_param ?? "idle"}</p>
<p data-testid="handler-action-event-request">{form?.event_request_id ?? "idle"}</p>
<p data-testid="handler-action-method">{form?.method ?? "idle"}</p>
<p data-testid="handler-action-request">{form?.request_id ?? "idle"}</p>
<p data-testid="handler-action-route">{form?.route_id ?? "idle"}</p>
