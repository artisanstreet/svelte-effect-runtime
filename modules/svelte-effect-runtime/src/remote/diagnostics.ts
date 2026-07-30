import { Cause } from "effect";

/**
 * Why a remote failure reached the client without its original detail.
 *
 * @example
 * ```ts
 * const reason: OpaqueRemoteFailureReason = "untagged";
 * ```
 *
 * @since 4.2.0
 */
export type OpaqueRemoteFailureReason = "untagged" | "unserializable" | "unknown" | "interrupted";

/**
 * Request detail attached to an opaque remote failure report so the log line
 * points at the handler that produced it.
 *
 * @example
 * ```ts
 * const context: RemoteFailureContext = { method: "POST", url: "/checkout" };
 * ```
 *
 * @since 4.2.0
 */
export type RemoteFailureContext = {
	readonly method?: string;
	readonly route?: string;
	readonly url?: string;
};

type Reporter = (message: string) => void;

const explanations: Readonly<Record<OpaqueRemoteFailureReason, string>> = {
	untagged:
		"the failure has no string `_tag`, so it cannot be told apart from an arbitrary object on the wire",
	unserializable:
		"the failure could not be serialized, even after being reduced to its own enumerable properties",
	unknown: "the cause carries no failure reason, so there was nothing to serialize",
	interrupted: "the handler's fiber was interrupted before it produced a result",
};

const remedies: Readonly<Record<OpaqueRemoteFailureReason, string>> = {
	untagged:
		"Fail with a tagged error (`Data.TaggedError` or `Schema.TaggedError`) so SER can carry it to the client.",
	unserializable:
		"Remove non-transportable values (functions, class instances, cycles) from the error, or map it to a tagged error first.",
	unknown:
		"Check for a defect thrown outside the Effect error channel; the original value is shown above.",
	interrupted:
		"An interrupt usually means the runtime was disposed mid-request, for example when the dev server restarted while this request was in flight.",
};

/**
 * Reports a remote failure that had to be replaced with an opaque envelope.
 *
 * SER cannot send an unrecognized failure to the browser, so the client only
 * ever sees a generic 500. Without this report the original error would be
 * lost entirely, which is the difference between a debuggable failure and a
 * silent one.
 *
 * @example
 * ```ts
 * report_opaque_remote_failure("untagged", cause, value, { url: "/checkout" });
 * ```
 *
 * @since 4.2.0
 * @param reason - Why the failure could not be transported.
 * @param cause - Full Effect cause behind the failure.
 * @param value - The original failure value, when one was found.
 * @param context - Optional request detail for the log header.
 * @param report - Sink for the rendered report; defaults to `console.error`.
 */
export function report_opaque_remote_failure(
	reason: OpaqueRemoteFailureReason,
	cause: Cause.Cause<unknown>,
	value: unknown,
	context?: RemoteFailureContext,
	report: Reporter = default_reporter,
): void {
	report(render_opaque_remote_failure(reason, cause, value, context));
}

/**
 * Renders the report emitted by {@link report_opaque_remote_failure}.
 *
 * @example
 * ```ts
 * const message = render_opaque_remote_failure("untagged", cause, value);
 * ```
 *
 * @since 4.2.0
 * @param reason - Why the failure could not be transported.
 * @param cause - Full Effect cause behind the failure.
 * @param value - The original failure value, when one was found.
 * @param context - Optional request detail for the log header.
 * @returns The multi-line report.
 */
export function render_opaque_remote_failure(
	reason: OpaqueRemoteFailureReason,
	cause: Cause.Cause<unknown>,
	value: unknown,
	context?: RemoteFailureContext,
): string {
	const request = render_request(context);
	const lines = [
		"[svelte-effect-runtime] A remote handler failed with an error that could not be sent to the client.",
		`  Reason: ${explanations[reason]}.`,
	];

	if (request) {
		lines.push(`  Request: ${request}`);
	}

	if (reason !== "interrupted") {
		lines.push(`  Failure: ${inspect_failure(value)}`);
	}

	lines.push("  Cause:", indent(pretty_cause(cause)), `  Fix: ${remedies[reason]}`);

	return lines.join("\n");
}

function render_request(context?: RemoteFailureContext): string | undefined {
	if (!context) {
		return undefined;
	}

	const target = context.url ?? context.route;
	const parts = [context.method, target].filter(Boolean);
	const names_route = Boolean(context.route && context.url && context.route !== context.url);
	const route = names_route ? ` (route ${context.route})` : "";

	if (parts.length === 0) {
		return undefined;
	}

	return `${parts.join(" ")}${route}`;
}

function pretty_cause(cause: Cause.Cause<unknown>): string {
	try {
		return Cause.pretty(cause);
	} catch {
		return String(cause);
	}
}

/**
 * Renders the failure value itself. Errors keep their stack because that is
 * the only part of an untagged failure that identifies its source.
 */
function inspect_failure(value: unknown): string {
	if (value === undefined) {
		return "(none)";
	}

	if (value instanceof globalThis.Error) {
		return value.stack ?? `${value.name}: ${value.message}`;
	}

	if (typeof value !== "object" || value === null) {
		return String(value);
	}

	try {
		return JSON.stringify(value, undefined, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function indent(value: string): string {
	return value
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n");
}

function default_reporter(message: string): void {
	console.error(message);
}
