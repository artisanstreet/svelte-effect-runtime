import { compare, valid } from "semver";

export function validate_semantic_version(value: string): string {
	if (value.startsWith("v") || valid(value) === null) {
		throw new Error(`Invalid semantic version: ${value}.`);
	}

	return value;
}

export function compare_semantic_versions(left: string, right: string): number {
	validate_semantic_version(left);
	validate_semantic_version(right);

	return compare(left, right);
}

export function parse_release_tag(tag: string): string | undefined {
	if (!tag.startsWith("v")) {
		return undefined;
	}

	const version = tag.slice(1);

	return valid(version) === null ? undefined : version;
}
