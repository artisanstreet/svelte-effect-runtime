/** oxlint-disable no-explicit-any */
import { is_invalid_position, SnapshotDocumentMapper } from "./document-mappers.ts";
import type { Mapper } from "./types.ts";

export function rebind_snapshot_to_original_document(
	snapshot: any,
	originalDocument: any,
	prepared: { document: any; preprocessMapper: Mapper },
) {
	const innerMapper = snapshot.getMapper();
	snapshot.mapper = new SnapshotDocumentMapper(
		innerMapper,
		prepared.preprocessMapper,
		originalDocument.uri,
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
			originalDocument,
			prepared.preprocessMapper,
		);
	}

	snapshot.parent = originalDocument;
	snapshot.version = originalDocument.version;
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
	preprocessedDocument: any,
	originalDocument: any,
	preprocessMapper: Mapper,
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
					preprocessedDocument,
					originalDocument,
					preprocessMapper,
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
				preprocessedDocument,
				originalDocument,
				preprocessMapper,
			);
			continue;
		}

		clone[key] = clone_ast_with_original_offsets(
			child,
			preprocessedDocument,
			originalDocument,
			preprocessMapper,
			seen,
		);
	}

	return clone;
}

function map_offset_to_original(
	offset: number,
	preprocessedDocument: any,
	originalDocument: any,
	preprocessMapper: Mapper,
) {
	const originalPosition = preprocessMapper.getOriginalPosition(
		preprocessedDocument.positionAt(offset),
	);

	if (is_invalid_position(originalPosition)) {
		return offset;
	}

	return originalDocument.offsetAt(originalPosition);
}
