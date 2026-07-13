export function to_form_data(input: unknown): FormData {
	const form_data = new FormData();

	append_form_value(form_data, "", input);

	return form_data;
}

function append_form_value(form_data: FormData, path: string, value: unknown): void {
	if (value === undefined) {
		return;
	}

	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			append_form_value(form_data, `${path}[${index}]`, item);
		}

		return;
	}

	if (value instanceof Blob) {
		form_data.append(path, value);

		return;
	}

	if (typeof value === "object" && value !== null) {
		for (const [key, child] of Object.entries(value)) {
			const child_path = path.length === 0 ? key : `${path}.${key}`;

			append_form_value(form_data, child_path, child);
		}

		return;
	}

	if (typeof value === "number") {
		form_data.append(`n:${path}`, String(value));

		return;
	}

	if (typeof value === "boolean") {
		if (value) {
			form_data.append(`b:${path}`, "on");
		}

		return;
	}

	form_data.append(path, value === null ? "" : String(value));
}
