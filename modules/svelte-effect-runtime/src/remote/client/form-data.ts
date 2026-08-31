/**
 * Encodes a remote form input the way SvelteKit's `convert_formdata` expects.
 * SvelteKit 3.0.0-next.14+ requires every field name to end with `/<form_id>`
 * (the un-keyed remote action id), so callers pass the id whenever they target
 * that wire format. SvelteKit 2 servers never see this encoding because they
 * ship the binary form bridge, which bypasses `FormData` entirely.
 */
export function to_form_data(input: unknown, form_id?: string): FormData {
	const form_data = new FormData();
	const suffix = form_id === undefined ? "" : `/${form_id}`;

	append_form_value(form_data, "", suffix, input);

	return form_data;
}

function append_form_value(
	form_data: FormData,
	path: string,
	suffix: string,
	value: unknown,
): void {
	if (value === undefined) {
		return;
	}

	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			append_form_value(form_data, `${path}[${index}]`, suffix, item);
		}

		return;
	}

	if (value instanceof Blob) {
		form_data.append(`${path}${suffix}`, value);

		return;
	}

	if (typeof value === "object" && value !== null) {
		for (const [key, child] of Object.entries(value)) {
			const child_path = path.length === 0 ? key : `${path}.${key}`;

			append_form_value(form_data, child_path, suffix, child);
		}

		return;
	}

	if (typeof value === "number") {
		form_data.append(`n:${path}${suffix}`, String(value));

		return;
	}

	if (typeof value === "boolean") {
		form_data.append(`b:${path}${suffix}`, value ? "on" : "off");

		return;
	}

	form_data.append(`${path}${suffix}`, value === null ? "" : String(value));
}
