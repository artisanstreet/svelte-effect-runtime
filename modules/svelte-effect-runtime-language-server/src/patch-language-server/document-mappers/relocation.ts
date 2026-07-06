import { create_source_map_mapper } from "./source-map.ts";
import { is_invalid_position, OffsetTable } from "./position.ts";
import type { DocumentPosition, Mapper, Relocation } from "../types.ts";

/**
 * Result of creating a relocation mapper for a transform result.
 *
 * @example
 * ```ts
 * const result = create_relocation_mapper(source, generated, relocations);
 * if (result._tag === "RelocationMapperFound") return result.mapper;
 * ```
 *
 * @since 3.4.6
 */
export type RelocationMapperResult =
	| {
			_tag: "RelocationMapperFound";
			mapper: Mapper;
	  }
	| {
			_tag: "RelocationMapperMissing";
	  };

type RelocationSearchResult =
	| {
			_tag: "RelocationFound";
			relocation: Relocation;
	  }
	| {
			_tag: "RelocationMissing";
	  };

/**
 * Creates a mapper that first consults relocation ranges before falling back
 * to the transform source map.
 *
 * @example
 * ```ts
 * const mapper = create_relocated_source_mapper(source, code, map, ranges, uri);
 * ```
 *
 * @since 2.0.0
 * @param original_code - Source code before the transform.
 * @param transformed_code - Source code after the transform.
 * @param raw_map - Source map returned by the runtime transform.
 * @param relocations - Offset ranges that were moved during the transform.
 * @param source_uri - URI of the original Svelte document.
 * @returns Mapper that translates positions through relocations and maps.
 */
export function create_relocated_source_mapper(
	original_code: string,
	transformed_code: string,
	raw_map: Record<string, unknown>,
	relocations: Array<Relocation>,
	source_uri: string,
): Mapper {
	const source_mapper = create_source_map_mapper(raw_map, source_uri);
	const relocation_mapper = create_relocation_mapper(
		original_code,
		transformed_code,
		relocations,
	);

	if (relocation_mapper._tag === "RelocationMapperMissing") {
		return source_mapper;
	}

	return {
		getOriginalPosition(generated_position: DocumentPosition) {
			const relocated_position =
				relocation_mapper.mapper.getOriginalPosition(generated_position);

			if (!is_invalid_position(relocated_position)) {
				return relocated_position;
			}

			return source_mapper.getOriginalPosition(generated_position);
		},
		getGeneratedPosition(original_position: DocumentPosition) {
			const relocated_position =
				relocation_mapper.mapper.getGeneratedPosition(original_position);

			if (!is_invalid_position(relocated_position)) {
				return relocated_position;
			}

			return source_mapper.getGeneratedPosition(original_position);
		},
		isInGenerated(original_position: DocumentPosition) {
			const generated_position = this.getGeneratedPosition(original_position);

			return !is_invalid_position(generated_position);
		},
	};
}

/**
 * Creates a direct position mapper for relocation ranges.
 *
 * @example
 * ```ts
 * const mapper = create_relocation_mapper(source, generated, relocations);
 * ```
 *
 * @since 2.0.0
 * @param original_content - Original text for offset conversion.
 * @param transformed_content - Transformed text for offset conversion.
 * @param relocations - Offset ranges linking original and generated text.
 * @returns Tagged result containing a relocation mapper, or a missing variant
 *   when no ranges exist.
 */
export function create_relocation_mapper(
	original_content: string,
	transformed_content: string,
	relocations: Array<Relocation>,
): RelocationMapperResult {
	if (relocations.length === 0) {
		return { _tag: "RelocationMapperMissing" };
	}

	const original_offsets = new OffsetTable(original_content);
	const transformed_offsets = new OffsetTable(transformed_content);

	return {
		_tag: "RelocationMapperFound",
		mapper: {
			getOriginalPosition(generated_position: DocumentPosition) {
				const generated_offset = transformed_offsets.offsetAt(generated_position);
				const relocation_result = find_relocation(
					relocations,
					generated_offset,
					"generatedStart",
					"generatedEnd",
				);

				if (relocation_result._tag === "RelocationMissing") {
					return { line: -1, character: -1 };
				}

				const relocation = relocation_result.relocation;

				return original_offsets.positionAt(
					map_offset_between_ranges(
						generated_offset,
						relocation.generatedStart,
						relocation.generatedEnd,
						relocation.originalStart,
						relocation.originalEnd,
					),
				);
			},
			getGeneratedPosition(original_position: DocumentPosition) {
				const original_offset = original_offsets.offsetAt(original_position);
				const relocation_result = find_relocation(
					relocations,
					original_offset,
					"originalStart",
					"originalEnd",
				);

				if (relocation_result._tag === "RelocationMissing") {
					return { line: -1, character: -1 };
				}

				const relocation = relocation_result.relocation;

				return transformed_offsets.positionAt(
					map_offset_between_ranges(
						original_offset,
						relocation.originalStart,
						relocation.originalEnd,
						relocation.generatedStart,
						relocation.generatedEnd,
					),
				);
			},
			isInGenerated(original_position: DocumentPosition) {
				return !is_invalid_position(this.getGeneratedPosition(original_position));
			},
		},
	};
}

function find_relocation(
	relocations: Array<Relocation>,
	offset: number,
	start_key: "originalStart" | "generatedStart",
	end_key: "originalEnd" | "generatedEnd",
): RelocationSearchResult {
	const relocation = relocations
		.filter((candidate) => offset >= candidate[start_key] && offset <= candidate[end_key])
		.sort(
			(left, right) => left[end_key] - left[start_key] - (right[end_key] - right[start_key]),
		)[0];

	if (!relocation) {
		return { _tag: "RelocationMissing" };
	}

	return {
		_tag: "RelocationFound",
		relocation,
	};
}

function map_offset_between_ranges(
	offset: number,
	source_start: number,
	source_end: number,
	target_start: number,
	target_end: number,
): number {
	if (offset <= source_start) {
		return target_start;
	}

	if (offset >= source_end) {
		return target_end;
	}

	const source_length = Math.max(source_end - source_start, 1);
	const target_length = Math.max(target_end - target_start, 1);
	const relative_offset = Math.min(Math.max(offset - source_start, 0), source_length - 1);

	return target_start + Math.min(relative_offset, target_length - 1);
}
