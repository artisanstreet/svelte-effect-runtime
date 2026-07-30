import { Effect } from "effect";

export function normalize_error(
	error: unknown,
	options: {
		readonly include_cause?: boolean;
	} = {},
) {
	return Effect.gen(function* () {
		if (!error || typeof error !== "object") {
			return String(error);
		}

		const body = Reflect.get(error, "body");
		const body_message =
			body && typeof body === "object" ? Reflect.get(body, "message") : undefined;
		const message = Reflect.get(error, "message");
		const status = Reflect.get(error, "status");
		const cause = Reflect.get(error, "cause");
		const cause_message =
			cause && typeof cause === "object" ? Reflect.get(cause, "message") : undefined;

		return `${typeof status === "number" ? status : 0}:${
			typeof body_message === "string"
				? body_message
				: typeof message === "string"
					? message
					: options.include_cause && typeof cause_message === "string"
						? cause_message
						: "unknown"
		}`;
	});
}
