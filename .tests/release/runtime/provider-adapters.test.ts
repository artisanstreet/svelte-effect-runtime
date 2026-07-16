import {
	find_github_release_by_tag,
	github_next_page,
	resolve_provider_artifact_path,
} from "../../../build/release/provider-adapters.ts";
import { expect, test } from "vitest";

import path from "node:path";

test("draft releases remain inspectable when GitHub hides them from the tag endpoint", () => {
	const release = find_github_release_by_tag(
		[
			{
				tag_name: "v4.0.1",
				html_url: "https://github.com/usebarekey/svelte-effect-runtime/releases/untagged",
				name: "v4.0.1",
				body: "Verified release notes",
				draft: true,
				assets: [],
			},
		],
		"v4.0.1",
	);

	expect(release).toMatchObject({ tag_name: "v4.0.1", draft: true });
});

test("GitHub draft inspection follows authenticated release pagination", () => {
	const headers = new Headers({
		link: '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/releases?per_page=100&page=4>; rel="last"',
	});

	expect(github_next_page(headers)).toEqual({
		_tag: "Next",
		url: "https://api.github.com/repositories/1/releases?per_page=100&page=2",
	});
});

test("GitHub draft inspection rejects unsafe pagination links", () => {
	const headers = new Headers({
		link: '<https://example.com/releases?page=2>; rel="next"',
	});

	expect(github_next_page(headers)).toEqual({
		_tag: "Rejected",
		reason: "GitHub release pagination returned an unsafe next link.",
	});
});

test("publication commands receive an absolute immutable artifact path", () => {
	const artifact_path = resolve_provider_artifact_path(
		path,
		"release-candidate/artifacts/extension.vsix",
	);

	expect(path.isAbsolute(artifact_path)).toBe(true);
	expect(artifact_path).toBe(
		path.resolve(process.cwd(), "release-candidate/artifacts/extension.vsix"),
	);
});
