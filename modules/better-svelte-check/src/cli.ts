#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { CheckProject } from "./checker/index.ts";
import { Effect, Path, Runtime, Schema } from "effect";

const CliOptions = Schema.Struct({
	workspace: Schema.String,
	tsconfig: Schema.String,
	mode: Schema.String,
	output: Schema.Literals(["human", "json"]),
});

const Main = Effect.gen(function* () {
	const path = yield* Path.Path;
	const arguments_ = process.argv.slice(2);
	const values: Record<string, string> = {
		workspace: process.cwd(),
		tsconfig: "tsconfig.json",
		mode: "development",
		output: "human",
	};

	if (arguments_.includes("--help")) {
		console.log(
			"better-svelte-check [--workspace path] [--tsconfig path] [--mode name] [--output human|json]\nOne-shot checking through Vite. Watch mode is not supported by this MVP.",
		);

		return;
	}

	for (const [index, argument] of arguments_.entries()) {
		if (index % 2 !== 0) {
			continue;
		}

		const option = argument.slice(2);
		const value = arguments_[index + 1];

		if (
			!arguments_[index]?.startsWith("--") ||
			!(option in values) ||
			!value ||
			value.startsWith("--")
		) {
			return yield* Effect.fail(
				new Error(
					`Unsupported or incomplete argument: ${arguments_[index]}. Run --help for supported options.`,
				),
			);
		}

		values[option] = value;
	}

	const options = yield* Schema.decodeUnknownEffect(CliOptions)(values);
	const diagnostics = yield* Effect.scoped(
		Effect.gen(function* () {
			const original_log = console.log;

			/** Reserve stdout for results even when project plugins print during initialization. */
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					console.log = (...args) => console.error(...args);
				}),
				() =>
					Effect.sync(() => {
						console.log = original_log;
					}),
			);

			return yield* CheckProject({ ...options, workspace: path.resolve(options.workspace) });
		}),
	);
	const errors = diagnostics
		.flatMap((file) => file.diagnostics)
		.filter((diagnostic) => diagnostic.severity === 1).length;
	const warnings = diagnostics
		.flatMap((file) => file.diagnostics)
		.filter((diagnostic) => diagnostic.severity === 2).length;

	if (options.output === "json") {
		console.log(JSON.stringify({ errors, warnings, files: diagnostics }));
	} else {
		for (const file of diagnostics) {
			for (const diagnostic of file.diagnostics) {
				const { line, character } = diagnostic.range.start;

				console.log(
					`${path.relative(options.workspace, file.filePath)}:${line + 1}:${character + 1} ${diagnostic.severity === 1 ? "error" : "warning"}: ${diagnostic.message}`,
				);
			}
		}

		console.log(`Found ${errors} errors and ${warnings} warnings.`);
	}

	process.exitCode = errors > 0 ? 1 : 0;
});

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)), {
	/** Project plugins can retain handles after Vite closes; flush results before ending this one-shot process. */
	teardown: (exit) =>
		Runtime.defaultTeardown(exit, (code) => {
			const exit_code = code === 0 ? Number(process.exitCode ?? 0) : code;

			process.stdout.write("", () => {
				process.stderr.write("", () => process.exit(exit_code));
			});
		}),
});
