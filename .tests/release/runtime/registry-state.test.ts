import {
	classify_provider_state,
	decide_probe,
	type ProviderState,
} from "../../../build/release/registry-state.ts";
import { expect, test } from "vitest";

const npm_digest =
	"sha512-UsvhFDlKFdvG5iBIim51IqRrst/stYJ8hQ5V/aP0Bmz9fv7MVgX9g4vC1Ky4x0M+8g7j7dJkJXW91WnrPcRToA==";
const sha256 = "a".repeat(64);
const other_sha256 = "b".repeat(64);

test("404 means the planned artifact is absent", () => {
	expect(
		classify_provider_state({
			_tag: "HttpResponse",
			provider: "npm",
			status: 404,
			url: "https://registry.npmjs.org/pkg/4.1.0",
			expected_digest: npm_digest,
		}),
	).toEqual({
		_tag: "Absent",
		url: "https://registry.npmjs.org/pkg/4.1.0",
	});
});

test("npm compares the registry sha512 SRI with the packed tarball", () => {
	expect(
		classify_provider_state({
			_tag: "HttpResponse",
			provider: "npm",
			status: 200,
			url: "https://registry.npmjs.org/pkg/4.1.0",
			expected_digest: npm_digest,
			observed_digest: npm_digest,
		}),
	).toEqual({
		_tag: "Matching",
		url: "https://registry.npmjs.org/pkg/4.1.0",
		digest: npm_digest,
	});
});

test("OpenVSX and GitHub sha256 forms normalize to one comparable identity", () => {
	const openvsx = classify_provider_state({
		_tag: "HttpResponse",
		provider: "openvsx",
		status: 200,
		url: "https://open-vsx.org/artifact.sha256",
		expected_digest: sha256,
		observed_digest: `${sha256}  extension.vsix`,
	});
	const github = classify_provider_state({
		_tag: "HttpResponse",
		provider: "github-release",
		status: 200,
		url: "https://api.github.com/release/asset",
		expected_digest: sha256,
		observed_digest: `sha256:${sha256}`,
	});

	expect(openvsx).toMatchObject({ _tag: "Matching", digest: `sha256:${sha256}` });
	expect(github).toMatchObject({ _tag: "Matching", digest: `sha256:${sha256}` });
});

test("an existing version with different bytes is a terminal mismatch", () => {
	expect(
		classify_provider_state({
			_tag: "HttpResponse",
			provider: "github-release",
			status: 200,
			url: "https://api.github.com/release/asset",
			expected_digest: sha256,
			observed_digest: `sha256:${other_sha256}`,
		}),
	).toEqual({
		_tag: "Mismatched",
		url: "https://api.github.com/release/asset",
		expected_digest: `sha256:${sha256}`,
		actual_digest: `sha256:${other_sha256}`,
	});
});

test.each([401, 403])("HTTP %s is an authentication failure", (status) => {
	expect(
		classify_provider_state({
			_tag: "HttpResponse",
			provider: "openvsx",
			status,
			url: "https://open-vsx.org/api/extension",
			expected_digest: sha256,
		}),
	).toEqual({
		_tag: "AuthenticationFailure",
		url: "https://open-vsx.org/api/extension",
		status,
	});
});

test.each([429, 500, 503])("HTTP %s is provider unavailability", (status) => {
	expect(
		classify_provider_state({
			_tag: "HttpResponse",
			provider: "npm",
			status,
			url: "https://registry.npmjs.org/pkg/4.1.0",
			expected_digest: npm_digest,
		}),
	).toEqual({
		_tag: "ProviderUnavailable",
		url: "https://registry.npmjs.org/pkg/4.1.0",
		status,
		reason: `Provider returned HTTP ${status}.`,
	});
});

test.each([400, 409, 422])("HTTP %s is a terminal provider rejection", (status) => {
	const state = classify_provider_state({
		_tag: "HttpResponse",
		provider: "openvsx",
		status,
		url: "https://open-vsx.org/api/extension",
		expected_digest: sha256,
	});

	expect(state).toEqual({
		_tag: "ProviderRejected",
		url: "https://open-vsx.org/api/extension",
		status,
		reason: `Provider rejected the request with HTTP ${status}.`,
	});
	expect(decide_probe(state, { attempt: 1, max_attempts: 5 })).toEqual({
		_tag: "Failed",
		state,
	});
});

test("a timeout is provider unavailability without inventing an HTTP status", () => {
	expect(
		classify_provider_state({
			_tag: "Timeout",
			provider: "openvsx",
			url: "https://open-vsx.org/api/extension",
			expected_digest: sha256,
			reason: "request exceeded 10 seconds",
		}),
	).toEqual({
		_tag: "ProviderUnavailable",
		url: "https://open-vsx.org/api/extension",
		status: undefined,
		reason: "request exceeded 10 seconds",
	});
});

test("probe policy retries propagation and then completes immediately on a match", () => {
	const absent: ProviderState = {
		_tag: "Absent",
		url: "https://registry.npmjs.org/pkg/4.1.0",
	};
	const matching: ProviderState = {
		_tag: "Matching",
		url: "https://registry.npmjs.org/pkg/4.1.0",
		digest: npm_digest,
	};

	expect(decide_probe(absent, { attempt: 1, max_attempts: 3 })).toEqual({
		_tag: "Retry",
		next_attempt: 2,
		reason: "artifact-not-visible",
	});
	expect(decide_probe(matching, { attempt: 2, max_attempts: 3 })).toEqual({
		_tag: "Complete",
		state: matching,
	});
});

test("probe policy reports exhausted retryable states with useful diagnostics", () => {
	const absent: ProviderState = {
		_tag: "Absent",
		url: "https://registry.npmjs.org/pkg/4.1.0",
	};
	const unavailable: ProviderState = {
		_tag: "ProviderUnavailable",
		url: "https://open-vsx.org/api/extension",
		status: 503,
		reason: "Provider returned HTTP 503.",
	};

	expect(decide_probe(absent, { attempt: 3, max_attempts: 3 })).toEqual({
		_tag: "Exhausted",
		attempts: 3,
		last_state: absent,
		diagnostic: "Artifact remained absent after 3 attempts.",
	});
	expect(decide_probe(unavailable, { attempt: 2, max_attempts: 2 })).toEqual({
		_tag: "Exhausted",
		attempts: 2,
		last_state: unavailable,
		diagnostic: "Provider remained unavailable after 2 attempts: Provider returned HTTP 503.",
	});
});

test("probe policy never retries authentication or integrity failures", () => {
	const authentication_failure: ProviderState = {
		_tag: "AuthenticationFailure",
		url: "https://open-vsx.org/api/extension",
		status: 403,
	};
	const mismatch: ProviderState = {
		_tag: "Mismatched",
		url: "https://api.github.com/release/asset",
		expected_digest: `sha256:${sha256}`,
		actual_digest: `sha256:${other_sha256}`,
	};

	expect(decide_probe(authentication_failure, { attempt: 1, max_attempts: 5 })).toEqual({
		_tag: "Failed",
		state: authentication_failure,
	});
	expect(decide_probe(mismatch, { attempt: 1, max_attempts: 5 })).toEqual({
		_tag: "Failed",
		state: mismatch,
	});
});
