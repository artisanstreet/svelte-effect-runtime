import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import type { SvelteCheck } from "svelte-language-server";
import type { PreparedSource } from "../pipeline.ts";

type FileDiagnostics = Awaited<ReturnType<SvelteCheck["getDiagnostics"]>>[number];
type Position = { line: number; character: number };

export function map_diagnostics(
	file: FileDiagnostics,
	prepared: PreparedSource | undefined,
): FileDiagnostics {
	if (!prepared) {
		return file;
	}

	const trace = new TraceMap(prepared.map as ConstructorParameters<typeof TraceMap>[0]);

	return {
		...file,
		text: prepared.original,
		diagnostics: file.diagnostics.map((diagnostic) => {
			const start = map_position(trace, diagnostic.range.start);
			const end = map_position(trace, diagnostic.range.end);

			return {
				...diagnostic,
				range: {
					start: start ?? { line: 0, character: 0 },
					end: end ?? start ?? { line: 0, character: 0 },
				},
				...(!start && {
					data: { positionUnknown: true },
					message: `[generated source] ${diagnostic.message}`,
				}),
			};
		}),
	};
}

function map_position(trace: TraceMap, position: Position): Position | undefined {
	const mapped = originalPositionFor(trace, {
		line: position.line + 1,
		column: position.character,
	});

	return mapped.line === null || mapped.column === null
		? undefined
		: { line: mapped.line - 1, character: mapped.column };
}
