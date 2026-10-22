import { GenMapping, addSegment, setSourceContent, toEncodedMap } from "@jridgewell/gen-mapping";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import type { ScriptRegion } from "../compiler/source-scan.ts";

interface Relocation {
	originalStart: number;
	originalEnd: number;
	generatedStart: number;
	generatedEnd: number;
}

interface MappedSource {
	code: string;
	map?: Record<string, unknown>;
	relocations?: Relocation[];
}

interface ScriptSource {
	region: ScriptRegion;
	result: MappedSource;
}

/** Composes fragment maps and relocated expressions into a whole-component map. */
export function create_component_source_map(
	original: string,
	intermediate: string,
	markup: MappedSource,
	filename: string,
	script?: ScriptSource,
): Record<string, unknown> {
	const original_lines = line_offsets(original);
	const map = new GenMapping({ file: filename });
	const markup_offset = create_offset_mapper(intermediate, markup);
	const script_offset = script
		? create_offset_mapper(script.region.text, script.result)
		: undefined;
	const removed_length = script?.region.effect_attribute
		? script.region.effect_attribute.end - script.region.effect_attribute.start
		: 0;
	const script_start = script ? script.region.content_start - removed_length : 0;
	const script_end = script_start + (script?.result.code.length ?? 0);
	let line = 0;
	let column = 0;

	setSourceContent(map, filename, original);

	/** Translate markup positions through the script replacement and attribute removal. */
	for (let offset = 0; offset <= markup.code.length; offset += 1) {
		let original_offset = markup_offset(offset);

		if (original_offset !== undefined && script && script_offset) {
			if (original_offset >= script_start && original_offset < script_end) {
				const fragment_offset = script_offset(original_offset - script_start);

				original_offset =
					fragment_offset === undefined
						? undefined
						: script.region.content_start + fragment_offset;
			} else if (original_offset >= script_end) {
				original_offset = script.region.content_end + original_offset - script_end;
			} else if (original_offset >= (script.region.effect_attribute?.start ?? script_start)) {
				original_offset += removed_length;
			}
		}

		if (original_offset === undefined) {
			addSegment(map, line, column);
		} else {
			const position = position_at(original_lines, original_offset);

			addSegment(map, line, column, filename, position.line, position.column);
		}

		if (markup.code[offset] === "\n") {
			line += 1;
			column = 0;
		} else {
			column += 1;
		}
	}

	return toEncodedMap(map) as unknown as Record<string, unknown>;
}

function create_offset_mapper(original: string, transformed: MappedSource) {
	const original_lines = line_offsets(original);
	const generated_lines = line_offsets(transformed.code);
	const trace = transformed.map
		? new TraceMap(transformed.map as ConstructorParameters<typeof TraceMap>[0])
		: undefined;
	const relocations = [...(transformed.relocations ?? [])].sort(
		(left, right) =>
			left.generatedEnd - left.generatedStart - (right.generatedEnd - right.generatedStart),
	);

	return (offset: number): number | undefined => {
		const relocation = relocations.find(
			(range) => offset >= range.generatedStart && offset < range.generatedEnd,
		);

		if (relocation) {
			return (
				relocation.originalStart +
				Math.min(
					offset - relocation.generatedStart,
					relocation.originalEnd - relocation.originalStart - 1,
				)
			);
		}

		if (original === transformed.code) {
			return offset;
		}

		if (!trace) {
			return undefined;
		}

		const generated = position_at(generated_lines, offset);
		const position = originalPositionFor(trace, {
			line: generated.line + 1,
			column: generated.column,
		});

		return position.line === null || position.column === null
			? undefined
			: (original_lines[position.line - 1] ?? 0) + position.column;
	};
}

function line_offsets(content: string): number[] {
	return [0, ...[...content.matchAll(/\n/g)].map((match) => match.index + 1)];
}

function position_at(lines: readonly number[], offset: number) {
	let low = 0;
	let high = lines.length - 1;

	while (low < high) {
		const middle = Math.ceil((low + high) / 2);

		if ((lines[middle] ?? 0) <= offset) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}

	return { line: low, column: offset - (lines[low] ?? 0) };
}
