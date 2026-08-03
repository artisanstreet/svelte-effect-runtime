import { Cause } from "effect";
import { error, redirect } from "@sveltejs/kit";

import * as fc from "fast-check";

/**
 * Generator for the failure values a remote handler can produce.
 *
 * The codec's contract is asymmetric: a tagged, serializable failure must reach
 * the client intact, and everything else must be replaced by an opaque payload
 * *and reported*, so the server can still log what was really thrown. The two
 * halves are generated separately because only the first supports a round-trip.
 */

export type FailureKind =
	| "tagged_serializable"
	| "tagged_lossy"
	| "untagged"
	| "form_error"
	| "control_flow"
	| "defect"
	| "interrupt";

export interface FailureSpec {
	readonly kind: FailureKind;
	readonly cause: Cause.Cause<unknown>;
	/** The value a round-trip must reproduce, when one is possible. */
	readonly expected?: unknown;
}

/** Tagged failures whose payloads devalue can encode. */
const tagged_serializable: fc.Arbitrary<FailureSpec> = fc
	.record({
		_tag: fc.constantFrom("NotFound", "Forbidden", "DbError", "ValidationFailed"),
		message: fc.string(),
		status: fc.integer({ min: 100, max: 599 }),
		details: fc.oneof(
			fc.constant(undefined),
			fc.array(fc.string(), { maxLength: 3 }),
			fc.record({ field: fc.string(), code: fc.integer() }),
		),
	})
	.map((value) => {
		/** devalue drops nothing here, so the decoded value must match exactly. */
		const failure = JSON.parse(JSON.stringify(value)) as unknown;

		return {
			kind: "tagged_serializable" as const,
			cause: Cause.fail(failure),
			expected: failure,
		};
	});

/**
 * Tagged failures carrying members devalue cannot represent.
 *
 * These do not become opaque: the encoder strips the offending members and
 * transports the rest, so the tag still reaches the client. The generator keeps
 * them because that stripping is the behaviour worth pinning down.
 */
const tagged_lossy: fc.Arbitrary<FailureSpec> = fc
	.constantFrom(
		() => ({ _tag: "WithFunction", handler: () => 1 }),
		() => ({ _tag: "WithSymbol", marker: Symbol("marker") }),
		() => {
			const value: Record<string, unknown> = { _tag: "Circular" };
			value.self = value;

			return value;
		},
		() => ({ _tag: "WithPromise", pending: Promise.resolve(1) }),
	)
	.map((build) => ({
		kind: "tagged_lossy" as const,
		cause: Cause.fail(build()),
	}));

const untagged: fc.Arbitrary<FailureSpec> = fc
	.oneof(
		fc.string(),
		fc.integer(),
		fc.constant(null),
		fc.constant(undefined),
		fc.record({ message: fc.string() }),
		fc.constant(new Error("plain error")),
	)
	.map((value) => ({
		kind: "untagged" as const,
		cause: Cause.fail(value),
	}));

const form_error: fc.Arbitrary<FailureSpec> = fc
	.array(
		fc.record({
			message: fc.string(),
			path: fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 3 }),
		}),
		{ maxLength: 4 },
	)
	.map((issues) => ({
		kind: "form_error" as const,
		cause: Cause.fail({ _tag: "FormError", issues }),
	}));

const control_flow: fc.Arbitrary<FailureSpec> = fc
	.oneof(
		fc.tuple(fc.constantFrom(400, 401, 403, 404, 500), fc.string()).map(
			([status, message]) =>
				() =>
					error(status, message),
		),
		/**
		 * Locations stay single-slash absolute paths: SvelteKit rejects
		 * protocol-relative targets as open redirects and throws an ordinary
		 * error instead of a redirect signal.
		 */
		fc
			.tuple(
				fc.constantFrom(301, 302, 303, 307, 308),
				fc.webSegment().map((segment) => `/${segment}`),
			)
			.map(
				([status, location]) =>
					() =>
						redirect(status, location),
			),
	)
	.map((build) => ({
		kind: "control_flow" as const,
		cause: Cause.die(capture(build)),
	}));

const defect: fc.Arbitrary<FailureSpec> = fc
	.oneof(fc.string(), fc.constant(new Error("boom")), fc.record({ nested: fc.string() }))
	.map((value) => ({
		kind: "defect" as const,
		cause: Cause.die(value),
	}));

const interrupt: fc.Arbitrary<FailureSpec> = fc.constant({
	kind: "interrupt" as const,
	cause: Cause.interrupt(),
});

/** SvelteKit control-flow helpers signal by throwing, so the value is caught. */
function capture(build: () => never): unknown {
	try {
		build();
	} catch (thrown) {
		return thrown;
	}

	return undefined;
}

const arbitraries: Record<FailureKind, fc.Arbitrary<FailureSpec>> = {
	tagged_serializable,
	tagged_lossy,
	untagged,
	form_error,
	control_flow,
	defect,
	interrupt,
};

export function make_failure_arbitrary(kinds: readonly FailureKind[]): fc.Arbitrary<FailureSpec> {
	return fc.oneof(...kinds.map((kind) => arbitraries[kind]));
}

export const all_failure_kinds: readonly FailureKind[] = Object.keys(arbitraries) as FailureKind[];

/**
 * Arbitrary values that can arrive on the wire, including shapes that imitate
 * the transport envelope closely enough to reach the decoder's inner paths.
 */
export const hostile_payload_arbitrary: fc.Arbitrary<unknown> = fc.oneof(
	fc.anything({ maxDepth: 3 }),
	fc.string(),
	fc.record({ __svelte_effect_remote__: fc.constant(true), encoded: fc.string() }),
	fc.record({ __svelte_effect_remote__: fc.constant(true), encoded: fc.anything() }),
	fc.record({ message: fc.string() }),
	fc.record({ message: fc.json() }),
	fc.record({ status: fc.integer(), body: fc.anything({ maxDepth: 2 }) }),
	fc.record({ body: fc.string() }),
	fc.record({ data: fc.anything({ maxDepth: 2 }) }),
	fc.json().map((text) => JSON.parse(text) as unknown),
);
