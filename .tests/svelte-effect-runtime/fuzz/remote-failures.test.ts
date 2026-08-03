import {
	all_failure_kinds,
	hostile_payload_arbitrary,
	make_failure_arbitrary,
	type FailureSpec,
} from "./grammar/failure.ts";
import {
	classify_remote_cause,
	encode_remote_failure,
	encode_remote_failure_detailed,
} from "../../../modules/svelte-effect-runtime/src/remote/cause-codec.ts";
import {
	create_serialized_remote_failure_envelope,
	is_serialized_remote_failure_envelope,
} from "../../../modules/svelte-effect-runtime/src/remote/shared.ts";
import {
	decode_remote_error,
	normalize_native_error,
} from "../../../modules/svelte-effect-runtime/src/remote/failures.ts";
import { parse } from "devalue";
import { expect, test } from "vitest";

import * as fc from "fast-check";

const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 250);
const fuzz_timeout = Math.max(30_000, fuzz_runs * 40);

const unknown_failure_message = "[UNKNOWN_REMOTE_FAILURE]: Unknown error";

const every_failure = make_failure_arbitrary(all_failure_kinds);

function describe_spec(spec: FailureSpec, extra = ""): string {
	return ["", `kind=${spec.kind}`, extra && "---------------- detail ----------------", extra]
		.filter(Boolean)
		.join("\n");
}

test(
	"classifying a cause never throws and always names a resolution",
	() => {
		fc.assert(
			fc.property(every_failure, (spec) => {
				const resolution = classify_remote_cause(spec.cause);

				expect(
					["SvelteKitControlFlow", "InterruptOnly", "FormInvalid", "RemoteFailure"],
					describe_spec(spec),
				).toContain(resolution._tag);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * The encoded payload is handed straight to a generated client, so it has to be
 * decodable no matter what the handler failed with. An encoder that emits
 * something devalue cannot read turns a domain failure into a transport error.
 */
test(
	"every encoded failure is decodable by the client decoder",
	() => {
		fc.assert(
			fc.property(every_failure, (spec) => {
				const encoded = encode_remote_failure(spec.cause);

				expect(() => parse(encoded), describe_spec(spec, encoded)).not.toThrow();
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"a tagged serializable failure survives the round trip intact",
	() => {
		fc.assert(
			fc.property(make_failure_arbitrary(["tagged_serializable"]), (spec) => {
				const encoded = encode_remote_failure(spec.cause);
				const envelope = create_serialized_remote_failure_envelope(encoded);
				const decoded = decode_remote_error(envelope);

				expect(decoded, describe_spec(spec, encoded)).toEqual(spec.expected);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * When detail cannot cross the boundary the client gets a placeholder. That is
 * only acceptable because the server is told, so it can log the real failure.
 * Silent replacement would erase the error everywhere at once.
 */
test(
	"detail lost during encoding is always reported to the server",
	() => {
		fc.assert(
			fc.property(every_failure, (spec) => {
				const resolution = classify_remote_cause(spec.cause);

				if (resolution._tag !== "RemoteFailure") {
					return;
				}

				const is_placeholder = resolution.encoded.includes(unknown_failure_message);

				expect(is_placeholder, describe_spec(spec, resolution.encoded)).toBe(
					resolution.opaque !== undefined,
				);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"an opaque report always names a reason",
	() => {
		fc.assert(
			fc.property(every_failure, (spec) => {
				const { opaque } = encode_remote_failure_detailed(spec.cause);

				if (!opaque) {
					return;
				}

				expect(["untagged", "unserializable", "unknown"], describe_spec(spec)).toContain(
					opaque.reason,
				);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * Decoding runs on whatever the network returned, which is the one input SER
 * genuinely does not control. A throw here escapes as an unhandled rejection
 * rather than a typed remote failure.
 */
test(
	"decoding never throws on arbitrary payloads",
	() => {
		fc.assert(
			fc.property(hostile_payload_arbitrary, (payload) => {
				expect(() => decode_remote_error(payload), JSON.stringify(payload)).not.toThrow();
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"a malformed envelope decodes to a transport error rather than throwing",
	() => {
		fc.assert(
			fc.property(fc.string(), (encoded) => {
				fc.pre(!is_valid_devalue(encoded));

				const decoded = decode_remote_error(
					create_serialized_remote_failure_envelope(encoded),
				);

				expect(decoded, encoded).toMatchObject({ _tag: "RemoteTransportError" });
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"normalizing a native error never throws and always yields a tagged failure",
	() => {
		fc.assert(
			fc.property(hostile_payload_arbitrary, (payload) => {
				let normalized: unknown;

				expect(() => {
					normalized = normalize_native_error(payload);
				}, JSON.stringify(payload)).not.toThrow();

				expect(
					typeof (normalized as { _tag?: unknown })?._tag,
					JSON.stringify(payload),
				).toBe("string");
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"the envelope guard accepts exactly what the encoder produces",
	() => {
		fc.assert(
			fc.property(every_failure, (spec) => {
				const envelope = create_serialized_remote_failure_envelope(
					encode_remote_failure(spec.cause),
				);

				expect(is_serialized_remote_failure_envelope(envelope), describe_spec(spec)).toBe(
					true,
				);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * Asserts that each generated failure kind actually reaches the branch it was
 * written to cover. Without this the properties above would still pass if the
 * generator quietly produced only one shape.
 */
test("every failure kind reaches its intended classification", () => {
	const expectations: Record<string, { tag: string; opaque?: string }> = {
		tagged_serializable: { tag: "RemoteFailure" },
		tagged_lossy: { tag: "RemoteFailure" },
		untagged: { tag: "RemoteFailure", opaque: "untagged" },
		form_error: { tag: "FormInvalid" },
		control_flow: { tag: "SvelteKitControlFlow" },
		defect: { tag: "RemoteFailure", opaque: "unknown" },
		interrupt: { tag: "InterruptOnly" },
	};

	const mismatches = all_failure_kinds.flatMap((kind) => {
		const spec = fc.sample(make_failure_arbitrary([kind]), { numRuns: 25, seed: 7 });

		return spec.flatMap((entry) => {
			const resolution = classify_remote_cause(entry.cause);
			const expected = expectations[kind];
			const opaque =
				resolution._tag === "RemoteFailure" ? resolution.opaque?.reason : undefined;

			if (resolution._tag !== expected.tag) {
				return [`${kind}: expected ${expected.tag}, saw ${resolution._tag}`];
			}

			return opaque === expected.opaque
				? []
				: [
						`${kind}: expected opaque ${expected.opaque ?? "none"}, saw ${opaque ?? "none"}`,
					];
		});
	});

	expect([...new Set(mismatches)]).toEqual([]);
});

function is_valid_devalue(encoded: string): boolean {
	try {
		parse(encoded);

		return true;
	} catch {
		return false;
	}
}
