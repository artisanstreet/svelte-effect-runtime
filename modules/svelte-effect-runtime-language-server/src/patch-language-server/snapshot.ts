/** oxlint-disable no-explicit-any */
import { is_invalid_position, SnapshotDocumentMapper } from "./document-mappers.ts";
import type { Mapper } from "./types.ts";

/**
 * Rebinds a transformed Svelte snapshot to its original document and source
 * coordinates.
 *
 * @example
 * ```ts
 * const rebound = rebind_snapshot_to_original_document(snapshot, document, prepared);
 * const original_position = rebound.getMapper().getOriginalPosition(position);
 * ```
 *
 * @since 2.0.0
 * @param snapshot - Snapshot created from the prepared virtual document and
 *   updated in place for language-server consumers.
 * @param original_document - Original Svelte document that owns the source
 *   positions exposed by the rebound snapshot.
 * @param prepared - Prepared virtual document and preprocessing mapper used to
 *   translate snapshot offsets back to the original source.
 * @returns The supplied snapshot after its mapper, diagnostics, AST, parent,
 *   and version have been rebound to the original document.
 */
export function rebind_snapshot_to_original_document(
	snapshot: any,
	original_document: any,
	prepared: { document: any; preprocessMapper: Mapper },
) {
	const inner_mapper = snapshot.getMapper();

	snapshot.mapper = new SnapshotDocumentMapper(
		inner_mapper,
		prepared.preprocessMapper,
		original_document.uri,
	);

	if (snapshot.parserError) {
		snapshot.parserError = {
			...snapshot.parserError,
			range: map_range(prepared.preprocessMapper, snapshot.parserError.range),
		};
	}

	if (snapshot.htmlAst) {
		snapshot.htmlAst = clone_ast_with_original_offsets(
			snapshot.htmlAst,
			prepared.document,
			original_document,
			prepared.preprocessMapper,
		);
	}

	snapshot.parent = original_document;
	snapshot.version = original_document.version;

	return snapshot;
}

function map_range(mapper: Mapper, range: { start: any; end: any }) {
	return {
		start: mapper.getOriginalPosition(range.start),
		end: mapper.getOriginalPosition(range.end),
	};
}

function clone_ast_with_original_offsets(
	value: any,
	preprocessed_document: any,
	original_document: any,
	preprocess_mapper: Mapper,
	seen = new WeakMap<object, any>(),
): any {
	if (!value || typeof value !== "object") {
		return value;
	}

	if (seen.has(value)) {
		return seen.get(value);
	}

	if (Array.isArray(value)) {
		const clone: any[] = [];
		seen.set(value, clone);
		for (const item of value) {
			clone.push(
				clone_ast_with_original_offsets(
					item,
					preprocessed_document,
					original_document,
					preprocess_mapper,
					seen,
				),
			);
		}
		return clone;
	}

	const clone = Object.create(Object.getPrototypeOf(value));
	seen.set(value, clone);

	for (const [key, child] of Object.entries(value)) {
		if ((key === "start" || key === "end") && typeof child === "number") {
			clone[key] = map_offset_to_original(
				child,
				preprocessed_document,
				original_document,
				preprocess_mapper,
			);
			continue;
		}

		clone[key] = clone_ast_with_original_offsets(
			child,
			preprocessed_document,
			original_document,
			preprocess_mapper,
			seen,
		);
	}

	return clone;
}

function map_offset_to_original(
	offset: number,
	preprocessed_document: any,
	original_document: any,
	preprocess_mapper: Mapper,
) {
	const original_position = preprocess_mapper.getOriginalPosition(
		preprocessed_document.positionAt(offset),
	);

	if (is_invalid_position(original_position)) {
		return offset;
	}

	return original_document.offsetAt(original_position);
}
