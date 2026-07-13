/**
 * Half-open source range in a Svelte component.
 *
 * @example
 * ```ts
 * const range: SourceRange = { start: 0, end: 10 };
 * ```
 *
 * @since 4.0.0
 */
export interface SourceRange {
	/** Inclusive start offset. */
	start: number;
	/** Exclusive end offset. */
	end: number;
}

/**
 * Attribute found in a Svelte opening tag.
 *
 * @example
 * ```ts
 * const attribute: SourceAttribute = {
 *   name: "lang",
 *   start: 8,
 *   end: 17,
 *   name_start: 9,
 *   name_end: 13,
 *   value: "ts",
 * };
 * ```
 *
 * @since 4.0.0
 */
export interface SourceAttribute extends SourceRange {
	/** Attribute name exactly as written in source. */
	name: string;
	/** Inclusive offset where the attribute name starts. */
	name_start: number;
	/** Exclusive offset where the attribute name ends. */
	name_end: number;
	/** Parsed string value when the attribute has one. */
	value?: string | undefined;
}

/**
 * Complete `<script>` region discovered by the shared source scanner.
 *
 * @example
 * ```ts
 * const script = scan_svelte_effect_source(source).effect_script;
 * script?.text;
 * ```
 *
 * @since 4.0.0
 */
export interface ScriptRegion extends SourceRange {
	/** Offset where the opening `<script` tag starts. */
	opening_tag_start: number;
	/** Offset immediately after the opening tag's `>` character. */
	opening_tag_end: number;
	/** Offset immediately after the `script` tag name. */
	tag_name_end: number;
	/** Offset where script content starts. */
	content_start: number;
	/** Offset where script content ends. */
	content_end: number;
	/** Offset where the closing `</script>` tag starts. */
	closing_tag_start: number;
	/** Offset immediately after the closing `</script>` tag. */
	closing_tag_end: number;
	/** Raw attribute text between `script` and `>`. */
	attributes_text: string;
	/** Parsed opening tag attributes. */
	attributes: readonly SourceAttribute[];
	/** Script content between the opening and closing tags. */
	text: string;
	/** Whether this is a module script. */
	is_module: boolean;
	/** Whether the script has a `lang` attribute. */
	has_lang: boolean;
	/** Parsed `lang` value when present. */
	lang?: string | undefined;
	/** Whether this script should be parsed as TypeScript. */
	is_typescript: boolean;
	/** Whether this script has SER's `effect` attribute. */
	has_effect: boolean;
	/** Range of the `effect` attribute, including leading whitespace. */
	effect_attribute?: SourceRange | undefined;
}

/**
 * Markup brace expression outside scripts, styles, and HTML comments.
 *
 * @example
 * ```ts
 * const [expression] = scan_svelte_effect_source(`<p>{name}</p>`).markup_expressions;
 * expression.expression_text;
 * ```
 *
 * @since 4.0.0
 */
export interface MarkupBraceExpression {
	/** Offset of the opening `{`. */
	open: number;
	/** Offset of the closing `}`. */
	close: number;
	/** Offset where the expression body starts. */
	inner_start: number;
	/** Offset where the expression body ends. */
	inner_end: number;
	/** Raw expression body between braces. */
	inner: string;
	/** Trimmed expression body. */
	expression_text: string;
	/** Attribute name when the expression is an attribute value. */
	attribute_name?: string | undefined;
}

/**
 * Bare declaration tag that the editor projection should normalize.
 *
 * @example
 * ```ts
 * const tags = scan_svelte_effect_source(`{const value = 1}`).bare_const_tags;
 * tags[0]?.insert_position;
 * ```
 *
 * @since 4.0.0
 */
export interface BareConstDeclarationTag {
	/** Offset of the opening `{`. */
	open: number;
	/** Offset after `{` where `@` should be inserted. */
	insert_position: number;
	/** Brace expression that contains the bare declaration. */
	expression: MarkupBraceExpression;
}

/**
 * Shared lexical facts for a Svelte source document.
 *
 * @example
 * ```ts
 * const scan = scan_svelte_effect_source(source, "App.svelte");
 * scan.effect_script?.text;
 * ```
 *
 * @since 4.0.0
 */
export interface SvelteEffectSourceScan {
	/** Source filename used for diagnostics and debugging. */
	filename: string;
	/** Full component source that was scanned. */
	source: string;
	/** All complete script regions in source order. */
	scripts: readonly ScriptRegion[];
	/** Complete style tag ranges in source order. */
	styles: readonly SourceRange[];
	/** HTML comment ranges in source order. */
	comments: readonly SourceRange[];
	/** Merged ranges where markup brace scanning should not enter. */
	excluded_ranges: readonly SourceRange[];
	/** Markup brace expressions outside excluded ranges. */
	markup_expressions: readonly MarkupBraceExpression[];
	/** Bare `{const ...}` tags outside excluded ranges. */
	bare_const_tags: readonly BareConstDeclarationTag[];
	/** First non-module script, if present. */
	instance_script?: ScriptRegion | undefined;
	/** First non-module script with SER's `effect` attribute, if present. */
	effect_script?: ScriptRegion | undefined;
}

interface TagRegion extends SourceRange {
	opening_tag_start: number;
	opening_tag_end: number;
	tag_name_end: number;
	content_start: number;
	content_end: number;
	closing_tag_start: number;
	closing_tag_end: number;
	attributes_text: string;
	attributes: readonly SourceAttribute[];
	text: string;
}

/**
 * Scans a Svelte component once for shared lexical facts used by transforms,
 * diagnostics, and editor projections. The scanner accepts raw SER syntax
 * before Svelte can parse it, so it deliberately stays tolerant and single-pass.
 *
 * @example
 * ```ts
 * const scan = scan_svelte_effect_source(`<script effect>yield* run()</script>`);
 * scan.effect_script?.has_effect;
 * ```
 *
 * @since 4.0.0
 * @param source - Full Svelte component source to scan.
 * @param filename - Optional filename associated with the source.
 * @returns Shared source facts for SER consumers.
 */
export function scan_svelte_effect_source(
	source: string,
	filename = "unknown.svelte",
): SvelteEffectSourceScan {
	const scripts = collect_script_regions(source);
	const styles = collect_tag_regions(source, "style").map(({ start, end }) => ({ start, end }));
	const comments = collect_html_comment_ranges(source);
	const excluded_ranges = merge_ranges([
		...scripts.map(({ start, end }) => ({ start, end })),
		...styles,
		...comments,
	]);
	const markup_expressions = collect_markup_expressions(source, excluded_ranges);
	const bare_const_tags = markup_expressions.flatMap((expression) =>
		make_bare_const_tag(expression),
	);
	const instance_script = scripts.find((script) => !script.is_module);
	const effect_script = scripts.find((script) => !script.is_module && script.has_effect);

	return {
		filename,
		source,
		scripts,
		styles,
		comments,
		excluded_ranges,
		markup_expressions,
		bare_const_tags,
		instance_script,
		effect_script,
	};
}

/**
 * Reuses a source scan after bare-const normalization inserts `@` characters.
 *
 * @example
 * ```ts
 * const shifted = shift_scan_after_at_insertions(scan, normalized, [tag.insert_position]);
 * ```
 *
 * @since 4.0.0
 * @param scan - Scan produced from the pre-normalization source.
 * @param normalized_source - Source after `@` insertions.
 * @param insert_positions - Offsets where `@` was inserted.
 * @returns A scan aligned to the normalized source without rescanning markup.
 */
export function shift_scan_after_at_insertions(
	scan: SvelteEffectSourceScan,
	normalized_source: string,
	insert_positions: readonly number[],
): SvelteEffectSourceScan {
	const inserts = [...insert_positions].sort((left, right) => left - right);
	const shift = (offset: number) =>
		offset + inserts.filter((position) => position <= offset).length;

	const shift_range = <T extends SourceRange>(range: T): T => ({
		...range,
		start: shift(range.start),
		end: shift(range.end),
	});

	const shift_attribute = (attribute: SourceAttribute): SourceAttribute => ({
		...shift_range(attribute),
		name: attribute.name,
		name_start: shift(attribute.name_start),
		name_end: shift(attribute.name_end),
		value: attribute.value,
	});

	const shift_script = (script: ScriptRegion): ScriptRegion => {
		const shifted = {
			...shift_range(script),
			opening_tag_start: shift(script.opening_tag_start),
			opening_tag_end: shift(script.opening_tag_end),
			tag_name_end: shift(script.tag_name_end),
			content_start: shift(script.content_start),
			content_end: shift(script.content_end),
			closing_tag_start: shift(script.closing_tag_start),
			closing_tag_end: shift(script.closing_tag_end),
			attributes_text: normalized_source.slice(
				shift(script.opening_tag_end),
				shift(script.content_start),
			),
			attributes: script.attributes.map(shift_attribute),
			text: normalized_source.slice(shift(script.content_start), shift(script.content_end)),
			is_module: script.is_module,
			has_lang: script.has_lang,
			lang: script.lang,
			is_typescript: script.is_typescript,
			has_effect: script.has_effect,
			effect_attribute: script.effect_attribute
				? shift_range(script.effect_attribute)
				: undefined,
		};

		return shifted;
	};

	const shift_expression = (expression: MarkupBraceExpression): MarkupBraceExpression => {
		const open = shift(expression.open);
		const close = shift(expression.close);
		const inner_start = shift(expression.inner_start);
		const inner_end = shift(expression.inner_end);
		const inner = normalized_source.slice(inner_start, inner_end);

		return {
			open,
			close,
			inner_start,
			inner_end,
			inner,
			expression_text: inner.trim(),
			attribute_name: expression.attribute_name,
		};
	};

	const scripts = scan.scripts.map(shift_script);

	return {
		filename: scan.filename,
		source: normalized_source,
		scripts,
		styles: scan.styles.map(shift_range),
		comments: scan.comments.map(shift_range),
		excluded_ranges: scan.excluded_ranges.map(shift_range),
		markup_expressions: scan.markup_expressions.map(shift_expression),
		bare_const_tags: [],
		instance_script: scan.instance_script ? shift_script(scan.instance_script) : undefined,
		effect_script: scan.effect_script ? shift_script(scan.effect_script) : undefined,
	};
}

function collect_script_regions(source: string): ScriptRegion[] {
	return collect_tag_regions(source, "script").map((region) => {
		const lang = get_attribute(region.attributes, "lang")?.value?.toLowerCase();
		const context = get_attribute(region.attributes, "context")?.value?.toLowerCase();
		const effect_attribute = get_attribute(region.attributes, "effect");
		const is_module = has_attribute(region.attributes, "module") || context === "module";

		return {
			...region,
			is_module,
			has_lang: has_attribute(region.attributes, "lang"),
			lang,
			is_typescript: lang === "ts" || lang === "typescript",
			has_effect: effect_attribute !== undefined,
			effect_attribute: effect_attribute
				? { start: effect_attribute.start, end: effect_attribute.end }
				: undefined,
		};
	});
}

function collect_tag_regions(source: string, tag_name: "script" | "style"): TagRegion[] {
	const lower_source = source.toLowerCase();
	const ranges: TagRegion[] = [];
	let cursor = 0;

	while (cursor < source.length) {
		const opening_tag_start = find_next_tag_start(lower_source, tag_name, cursor);

		if (opening_tag_start === -1) {
			break;
		}

		const opening_tag_close = find_tag_close(source, opening_tag_start);

		if (opening_tag_close === -1) {
			break;
		}

		const content_start = opening_tag_close + 1;
		const closing_tag_start = find_next_closing_tag_start(
			lower_source,
			tag_name,
			content_start,
		);

		if (closing_tag_start === -1) {
			cursor = content_start;
			continue;
		}

		const closing_tag_close = find_tag_close(source, closing_tag_start);

		if (closing_tag_close === -1) {
			break;
		}

		const tag_name_end = opening_tag_start + 1 + tag_name.length;
		const opening_tag_end = opening_tag_close + 1;
		const closing_tag_end = closing_tag_close + 1;
		const attributes = collect_attributes(source, tag_name_end, opening_tag_close);

		ranges.push({
			start: opening_tag_start,
			end: closing_tag_end,
			opening_tag_start,
			opening_tag_end,
			tag_name_end,
			content_start,
			content_end: closing_tag_start,
			closing_tag_start,
			closing_tag_end,
			attributes_text: source.slice(tag_name_end, opening_tag_close),
			attributes,
			text: source.slice(content_start, closing_tag_start),
		});

		cursor = closing_tag_end;
	}

	return ranges;
}

function collect_attributes(source: string, start: number, end: number): SourceAttribute[] {
	const attributes: SourceAttribute[] = [];
	let cursor = start;

	while (cursor < end) {
		const attribute_start = cursor;

		while (cursor < end && /\s/.test(source[cursor] ?? "")) {
			cursor += 1;
		}

		if (cursor >= end || source[cursor] === "/") {
			break;
		}

		const name_start = cursor;

		while (cursor < end && !/[\s=/>]/.test(source[cursor] ?? "")) {
			cursor += 1;
		}

		const name_end = cursor;
		const name = source.slice(name_start, name_end);

		while (cursor < end && /\s/.test(source[cursor] ?? "")) {
			cursor += 1;
		}

		if (source[cursor] !== "=") {
			attributes.push({
				name,
				start: attribute_start,
				end: name_end,
				name_start,
				name_end,
			});

			continue;
		}

		cursor += 1;

		while (cursor < end && /\s/.test(source[cursor] ?? "")) {
			cursor += 1;
		}

		const value = read_attribute_value(source, cursor, end);

		attributes.push({
			name,
			start: attribute_start,
			end: value.end,
			name_start,
			name_end,
			value: value.text,
		});

		cursor = value.end;
	}

	return attributes;
}

function read_attribute_value(
	source: string,
	start: number,
	end: number,
): { text: string; end: number } {
	const quote = source[start];

	if (quote === '"' || quote === "'") {
		let cursor = start + 1;

		while (cursor < end && source[cursor] !== quote) {
			cursor += 1;
		}

		return {
			text: source.slice(start + 1, cursor),
			end: Math.min(cursor + 1, end),
		};
	}

	let cursor = start;

	while (cursor < end && !/\s/.test(source[cursor] ?? "")) {
		cursor += 1;
	}

	return {
		text: source.slice(start, cursor),
		end: cursor,
	};
}

function collect_html_comment_ranges(source: string): SourceRange[] {
	const ranges: SourceRange[] = [];
	let cursor = 0;

	while (cursor < source.length) {
		const start = source.indexOf("<!--", cursor);

		if (start === -1) {
			break;
		}

		const close = source.indexOf("-->", start + "<!--".length);
		const end = close === -1 ? source.length : close + "-->".length;

		ranges.push({ start, end });

		cursor = end;
	}

	return ranges;
}

function collect_markup_expressions(
	source: string,
	excluded_ranges: readonly SourceRange[],
): MarkupBraceExpression[] {
	const expressions: MarkupBraceExpression[] = [];
	let cursor = 0;

	while (cursor < source.length) {
		const open = source.indexOf("{", cursor);

		if (open === -1) {
			break;
		}

		const excluded_range = find_range_containing(excluded_ranges, open);

		if (excluded_range) {
			cursor = excluded_range.end;
			continue;
		}

		const close = find_closing_brace(source, open + 1);

		if (close === -1) {
			cursor = open + 1;
			continue;
		}

		const inner_start = open + 1;
		const inner_end = close;
		const inner = source.slice(inner_start, inner_end);

		expressions.push({
			open,
			close,
			inner_start,
			inner_end,
			inner,
			expression_text: inner.trim(),
			attribute_name: find_attribute_name_before_expression(source, open, close),
		});

		cursor = close + 1;
	}

	return expressions;
}

function make_bare_const_tag(
	expression: MarkupBraceExpression,
): readonly BareConstDeclarationTag[] {
	if (!/^(\s*)const\s/.test(expression.inner)) {
		return [];
	}

	return [
		{
			open: expression.open,
			insert_position: expression.open + 1,
			expression,
		},
	];
}

function find_attribute_name_before_expression(
	source: string,
	open: number,
	close: number,
): string | undefined {
	const tag_start = source.lastIndexOf("<", open);
	const last_tag_end = source.lastIndexOf(">", open);

	if (tag_start === -1 || tag_start < last_tag_end) {
		return undefined;
	}

	const before_expression = source.slice(tag_start + 1, open);
	const match = before_expression.match(/(?:^|\s)([A-Za-z_$:][\w$:-]*)\s*=\s*(["']?)$/);
	const quote = match?.[2];

	if (quote && source[close + 1] !== quote) {
		return undefined;
	}

	return match?.[1];
}

function find_range_containing(
	ranges: readonly SourceRange[],
	position: number,
): SourceRange | undefined {
	let low = 0;
	let high = ranges.length - 1;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const range = ranges[mid];

		if (position < range.start) {
			high = mid - 1;
			continue;
		}

		if (position >= range.end) {
			low = mid + 1;
			continue;
		}

		return range;
	}

	return undefined;
}

function merge_ranges(ranges: SourceRange[]): SourceRange[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	const merged: SourceRange[] = [];

	for (const range of sorted) {
		const previous = merged.at(-1);

		if (!previous || range.start > previous.end) {
			merged.push({ ...range });
			continue;
		}

		previous.end = Math.max(previous.end, range.end);
	}

	return merged;
}

function get_attribute(
	attributes: readonly SourceAttribute[],
	name: string,
): SourceAttribute | undefined {
	const normalized_name = name.toLowerCase();

	return attributes.find((attribute) => attribute.name.toLowerCase() === normalized_name);
}

function has_attribute(attributes: readonly SourceAttribute[], name: string): boolean {
	return get_attribute(attributes, name) !== undefined;
}

function find_next_tag_start(
	lower_source: string,
	tag_name: "script" | "style",
	start: number,
): number {
	const needle = `<${tag_name}`;
	let cursor = start;

	while (cursor < lower_source.length) {
		const tag_start = lower_source.indexOf(needle, cursor);

		if (tag_start === -1) {
			return -1;
		}

		const boundary = lower_source[tag_start + needle.length];

		if (boundary === undefined || boundary === ">" || boundary === "/" || /\s/.test(boundary)) {
			return tag_start;
		}

		cursor = tag_start + needle.length;
	}

	return -1;
}

function find_next_closing_tag_start(
	lower_source: string,
	tag_name: "script" | "style",
	start: number,
): number {
	const needle = `</${tag_name}`;
	let cursor = start;

	while (cursor < lower_source.length) {
		const tag_start = lower_source.indexOf(needle, cursor);

		if (tag_start === -1) {
			return -1;
		}

		const boundary = lower_source[tag_start + needle.length];

		if (boundary === undefined || boundary === ">" || /\s/.test(boundary)) {
			return tag_start;
		}

		cursor = tag_start + needle.length;
	}

	return -1;
}

function find_tag_close(source: string, start: number): number {
	let quote: string | undefined;

	for (let cursor = start; cursor < source.length; cursor += 1) {
		const char = source[cursor];

		if (quote) {
			if (char === quote) {
				quote = undefined;
			}

			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}

		if (char === ">") {
			return cursor;
		}
	}

	return -1;
}

function find_closing_brace(source: string, start: number): number {
	let depth = 0;

	for (let cursor = start; cursor < source.length; cursor += 1) {
		const char = source[cursor];

		if (char === "{" && source[cursor - 1] !== "$") {
			depth += 1;
		} else if (char === "}") {
			if (depth === 0) {
				return cursor;
			}

			depth -= 1;
		} else if (char === "'" || char === '"' || char === "`") {
			cursor = skip_string(source, cursor, char);

			if (cursor === -1) {
				return -1;
			}
		} else if (char === "/" && source[cursor + 1] === "/") {
			cursor = skip_line_comment(source, cursor);
		} else if (char === "/" && source[cursor + 1] === "*") {
			cursor = skip_block_comment(source, cursor);

			if (cursor === -1) {
				return -1;
			}
		}
	}

	return -1;
}

function skip_string(source: string, start: number, quote: string): number {
	for (let cursor = start + 1; cursor < source.length; cursor += 1) {
		if (source[cursor] === "\\") {
			cursor += 1;
			continue;
		}

		if (source[cursor] === quote) {
			return cursor;
		}
	}

	return -1;
}

function skip_line_comment(source: string, start: number): number {
	for (let cursor = start + 2; cursor < source.length; cursor += 1) {
		if (source[cursor] === "\n") {
			return cursor;
		}
	}

	return source.length;
}

function skip_block_comment(source: string, start: number): number {
	for (let cursor = start + 2; cursor < source.length; cursor += 1) {
		if (source[cursor] === "*" && source[cursor + 1] === "/") {
			return cursor + 1;
		}
	}

	return -1;
}
