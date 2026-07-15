import { record_interrupt_event } from "$lib/server/interrupt-state.server";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ request }) => {
	record_interrupt_event("started");

	try {
		await new Promise<never>((_resolve, reject) => {
			const abort = () => reject(request.signal.reason ?? new Error("request aborted"));

			if (request.signal.aborted) {
				abort();

				return;
			}

			request.signal.addEventListener("abort", abort, { once: true });
		});
	} finally {
		record_interrupt_event("finalized");
	}

	return new Response(null, { status: 499 });
};
