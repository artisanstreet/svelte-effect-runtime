import type { DocumentPosition, FragmentTagInfo, Mapper, Relocation } from "../types.ts";
import type { SvelteInternalsService } from "../svelte-internals.ts";
import { create_relocation_mapper } from "./relocation.ts";
import { create_source_map_mapper } from "./source-map.ts";
import { is_invalid_position } from "./position.ts";

export function create_script_content_mapper(
	original_code: string,
	transformed_code: string,
	original_tag_info: FragmentTagInfo,
	transformed_tag_info: FragmentTagInfo,
	raw_map: Record<string, unknown>,
	relocations: Array<Relocation>,
	full_document_mapper: Mapper,
	source_uri: string,
	internals: SvelteInternalsService,
): Mapper {
	const original_fragment_mapper = new internals.fragment_mapper(
		original_code,
		original_tag_info,
		source_uri,
	) as Mapper;
	const transformed_fragment_mapper = new internals.fragment_mapper(
		transformed_code,
		transformed_tag_info,
		source_uri,
	) as Mapper;
	const source_mapper = create_source_map_mapper(
		raw_map,
		source_uri,
		internals.source_map_document_mapper,
	);
	const relocation_mapper = create_relocation_mapper(
		original_tag_info.content,
		transformed_tag_info.content,
		relocations,
	);

	return {
		getOriginalPosition(generated_position: DocumentPosition) {
			if (!transformed_fragment_mapper.isInGenerated(generated_position)) {
				return full_document_mapper.getOriginalPosition(generated_position);
			}

			const position_in_transformed_fragment =
				transformed_fragment_mapper.getGeneratedPosition(generated_position);

			if (is_invalid_position(position_in_transformed_fragment)) {
				return position_in_transformed_fragment;
			}

			const relocated_original_position =
				relocation_mapper._tag === "RelocationMapperFound"
					? relocation_mapper.mapper.getOriginalPosition(position_in_transformed_fragment)
					: { line: -1, character: -1 };

			if (!is_invalid_position(relocated_original_position)) {
				return original_fragment_mapper.getOriginalPosition(relocated_original_position);
			}

			const position_in_original_fragment = source_mapper.getOriginalPosition(
				position_in_transformed_fragment,
			);

			if (is_invalid_position(position_in_original_fragment)) {
				return position_in_original_fragment;
			}

			return original_fragment_mapper.getOriginalPosition(position_in_original_fragment);
		},
		getGeneratedPosition(original_position: DocumentPosition) {
			if (!original_fragment_mapper.isInGenerated(original_position)) {
				return full_document_mapper.getGeneratedPosition(original_position);
			}

			const position_in_original_fragment =
				original_fragment_mapper.getGeneratedPosition(original_position);

			if (is_invalid_position(position_in_original_fragment)) {
				return position_in_original_fragment;
			}

			const relocated_generated_position =
				relocation_mapper._tag === "RelocationMapperFound"
					? relocation_mapper.mapper.getGeneratedPosition(position_in_original_fragment)
					: { line: -1, character: -1 };

			if (!is_invalid_position(relocated_generated_position)) {
				return transformed_fragment_mapper.getOriginalPosition(
					relocated_generated_position,
				);
			}

			const position_in_transformed_fragment = source_mapper.getGeneratedPosition(
				position_in_original_fragment,
			);

			if (is_invalid_position(position_in_transformed_fragment)) {
				return position_in_transformed_fragment;
			}

			return transformed_fragment_mapper.getOriginalPosition(
				position_in_transformed_fragment,
			);
		},
		isInGenerated(original_position: DocumentPosition) {
			const generated_position = this.getGeneratedPosition(original_position);

			return !is_invalid_position(generated_position);
		},
	};
}
