import {
	EmptyStreamYieldError,
	InvalidYieldableError,
} from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { Dispatcher } from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { ToEffect } from "../../../modules/svelte-effect-runtime/src/yieldable.ts";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { afterEach, expect, test } from "vitest";

import * as fc from "fast-check";

/**
 * `ToEffect` sits on the generated ABI boundary: every component `yield*` is
 * lowered into a call to it, so it receives whatever the user's expression
 * evaluated to. It must therefore turn any value at all into an Effect, and
 * never throw — a synchronous throw here escapes the dispatcher entirely and
 * takes down component initialisation instead of surfacing as a failed effect.
 */

const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 100);
const fuzz_timeout = Math.max(30_000, fuzz_runs * 120);

type Outcome = "succeeds" | "empty_stream" | "invalid" | "fails";

interface YieldableSpec {
	readonly id: string;
	readonly outcome: Outcome;
	readonly build: () => unknown;
}

const specs: readonly YieldableSpec[] = [
	{ id: "effect_succeed", outcome: "succeeds", build: () => Effect.succeed("value") },
	{ id: "effect_sync", outcome: "succeeds", build: () => Effect.sync(() => "value") },
	{ id: "effect_void", outcome: "succeeds", build: () => Effect.void },
	{ id: "effect_fail", outcome: "fails", build: () => Effect.fail(new Error("failed")) },
	{ id: "effect_die", outcome: "fails", build: () => Effect.die(new Error("defect")) },
	{
		id: "generator_result",
		outcome: "succeeds",
		build: () =>
			(function* () {
				return yield* Effect.succeed("generated");
			})(),
	},
	{
		id: "generator_failing",
		outcome: "fails",
		build: () =>
			(function* () {
				return yield* Effect.fail(new Error("generated failure"));
			})(),
	},
	{ id: "stream_nonempty", outcome: "succeeds", build: () => Stream.make("head", "tail") },
	{ id: "stream_single", outcome: "succeeds", build: () => Stream.make("only") },
	{ id: "stream_empty", outcome: "empty_stream", build: () => Stream.empty },
	{
		id: "stream_from_empty_iterable",
		outcome: "empty_stream",
		build: () => Stream.fromIterable([]),
	},
	{ id: "stream_failing", outcome: "fails", build: () => Stream.fail(new Error("stream")) },

	/** Everything below is not yieldable and must be reported as such. */
	{ id: "null", outcome: "invalid", build: () => null },
	{ id: "undefined", outcome: "invalid", build: () => undefined },
	{ id: "number", outcome: "invalid", build: () => 42 },
	{ id: "string", outcome: "invalid", build: () => "text" },
	{ id: "boolean", outcome: "invalid", build: () => true },
	{ id: "empty_object", outcome: "invalid", build: () => ({}) },
	{ id: "array", outcome: "invalid", build: () => [1, 2, 3] },
	{ id: "function", outcome: "invalid", build: () => () => 1 },
	{ id: "promise", outcome: "invalid", build: () => Promise.resolve("resolved") },
	{ id: "date", outcome: "invalid", build: () => new Date(0) },
	{ id: "error", outcome: "invalid", build: () => new Error("plain") },
	{ id: "map", outcome: "invalid", build: () => new Map() },
];

const spec_arbitrary = fc.constantFrom(...specs);

let dispatcher: Dispatcher | undefined;
let counter = 0;

function get_dispatcher(): Dispatcher {
	dispatcher ??= new Dispatcher(ManagedRuntime.make(Layer.empty));

	return dispatcher;
}

afterEach(() => {
	dispatcher?.dispose();
	dispatcher = undefined;
});

/**
 * Runs the value through the same path generated code uses, rather than
 * executing the Effect directly, so the property covers the real boundary.
 */
async function observe(spec: YieldableSpec): Promise<Outcome> {
	counter += 1;

	const value = spec.build();

	try {
		await get_dispatcher().promise({
			id: `yieldable-${spec.id}-${counter}`,
			deps: [],
			factory: function* () {
				return yield* ToEffect(value as never);
			},
		});

		return "succeeds";
	} catch (issue) {
		if (issue instanceof InvalidYieldableError) {
			return "invalid";
		}

		if (issue instanceof EmptyStreamYieldError) {
			return "empty_stream";
		}

		return "fails";
	}
}

test(
	"every value shape reaches its documented outcome",
	async () => {
		await fc.assert(
			fc.asyncProperty(spec_arbitrary, async (spec) => {
				expect(await observe(spec), spec.id).toBe(spec.outcome);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"normalizing a value never throws synchronously",
	() => {
		fc.assert(
			fc.property(
				fc.oneof(
					spec_arbitrary.map((spec) => spec.build()),
					fc.anything(),
				),
				(value) => {
					expect(() => ToEffect(value as never), describe_value(value)).not.toThrow();
				},
			),
			{ numRuns: fuzz_runs * 4 },
		);
	},
	fuzz_timeout,
);

test(
	"an arbitrary non yieldable value always fails as invalid",
	async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.anything({ maxDepth: 2 }).filter((value) => !is_yieldable_shape(value)),
				async (value) => {
					counter += 1;

					await expect(
						get_dispatcher().promise({
							id: `arbitrary-${counter}`,
							deps: [],
							factory: function* () {
								return yield* ToEffect(value as never);
							},
						}),
					).rejects.toBeInstanceOf(InvalidYieldableError);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/** Null-prototype objects have no `toString`, so labelling must not assume one. */
function describe_value(value: unknown): string {
	try {
		return JSON.stringify(value) ?? Object.prototype.toString.call(value);
	} catch {
		return Object.prototype.toString.call(value);
	}
}

/** Mirrors the shapes `ToEffect` accepts, so the arbitrary excludes them. */
function is_yieldable_shape(value: unknown): boolean {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	return (
		typeof (value as { next?: unknown }).next === "function" ||
		Effect.isEffect(value) ||
		Stream.isStream(value)
	);
}
