import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path } from "effect";
import { parse } from "yaml";
import { pathToFileURL } from "node:url";

export type WorkflowPolicyInput = {
	readonly workflow: unknown;
	readonly setup_action: unknown;
	readonly workflow_files: ReadonlyArray<string>;
};

export const required_job_names = Object.freeze([
	"Plan",
	"Static policy",
	"Capability / Compiler",
	"Capability / Runtime and lifecycle",
	"Capability / Signals and reactivity",
	"Capability / Remote transport",
	"Capability / Public API",
	"Capability / Type contracts",
	"Capability / Package and tooling",
	"Staging verified",
	"Artifact / Runtime",
	"Artifact / Grammars",
	"Artifact / Language server",
	"Artifact / VSIX",
	"Candidate / Assemble or restore",
	"Candidate / Consumer smoke",
	"Candidate / Browser smoke",
	"Candidate verified",
	"Dry-run result",
	"Promote release",
	"Report",
]);

const artifact_job_ids = [
	"artifact_runtime",
	"artifact_grammars",
	"artifact_language_server",
	"artifact_vsix",
] as const;
const candidate_job_ids = [
	...artifact_job_ids,
	"candidate_assemble",
	"candidate_consumer_smoke",
	"candidate_browser_smoke",
	"candidate_verified",
	"dry_run",
	"promote",
] as const;
const expected_trigger_names = ["pull_request", "push", "workflow_dispatch"];
const forbidden_surface =
	/(?:marketplace\.visualstudio|visual studio marketplace|azure\/login|AZURE_(?:CLIENT|TENANT)|\btfx\b|\bjsr\b)/i;

export function find_workflow_policy_violations(input: WorkflowPolicyInput): ReadonlyArray<string> {
	const violations: Array<string> = [];
	const workflow = require_record(input.workflow, "workflow", violations);
	const setup_action = require_record(input.setup_action, "setup action", violations);
	const triggers = require_record(workflow.on, "workflow.on", violations);
	const jobs = require_record(workflow.jobs, "workflow.jobs", violations);
	const trigger_names = Object.keys(triggers).sort();
	const job_names = Object.values(jobs)
		.map((job) => optional_record(job)?.name)
		.filter((name): name is string => typeof name === "string");

	require_equal_list(
		trigger_names,
		[...expected_trigger_names].sort(),
		"workflow triggers",
		violations,
	);
	require_branch_trigger(triggers, "pull_request", violations);
	require_branch_trigger(triggers, "push", violations);
	require_equal_list(job_names, required_job_names, "stable job names", violations);

	if (Object.keys(optional_record(workflow.permissions) ?? {}).length !== 0) {
		violations.push("Workflow-level permissions must be empty.");
	}

	const root_concurrency = require_record(
		workflow.concurrency,
		"workflow.concurrency",
		violations,
	);

	if (!String(root_concurrency.group).includes("ser-ci-")) {
		violations.push("Ordinary CI requires a ref-scoped cancellation group.");
	}

	if (!String(root_concurrency["cancel-in-progress"]).includes("workflow_dispatch")) {
		violations.push("Manual runs must be excluded from workflow cancellation.");
	}

	for (const job_id of candidate_job_ids) {
		const job = require_job(jobs, job_id, violations);
		const serialized = JSON.stringify(job);

		if (
			!serialized.includes("workflow_dispatch") ||
			!serialized.includes("refs/heads/candidate")
		) {
			violations.push(`${job_id} must be gated on a manual candidate dispatch.`);
		}
	}

	for (const job_id of artifact_job_ids) {
		const job = require_job(jobs, job_id, violations);

		if (!String(job.if).includes("inputs.mode != 'resume'")) {
			violations.push(`${job_id} must be skipped during resume.`);
		}
	}

	const language_server = require_job(jobs, "artifact_language_server", violations);
	const assembly = require_job(jobs, "candidate_assemble", violations);
	const promotion = require_job(jobs, "promote", violations);
	const dry_run = require_job(jobs, "dry_run", violations);
	const promotion_concurrency = require_record(
		promotion.concurrency,
		"promote.concurrency",
		violations,
	);

	require_need(language_server, "artifact_runtime", "language-server build", violations);

	for (const dependency of ["plan", "staging_verified", ...artifact_job_ids]) {
		require_need(assembly, dependency, "candidate assembly", violations);
	}

	if (!String(assembly.if).includes("always()") || !String(assembly.if).includes("skipped")) {
		violations.push("Candidate assembly must explicitly handle skipped resume build jobs.");
	}

	if (promotion.environment !== "release") {
		violations.push("Promotion must be gated by the release environment.");
	}

	if (dry_run.environment !== undefined || JSON.stringify(dry_run).includes("secrets.")) {
		violations.push("Dry-run must not use an environment or repository secrets.");
	}

	if (!JSON.stringify(dry_run).includes("--dry-run true")) {
		violations.push("Dry-run must invoke the zero-write promotion mode.");
	}

	if (promotion_concurrency.group !== "ser-release" || promotion_concurrency.queue !== "max") {
		violations.push("Promotion must use the queued global release mutex.");
	}

	if (promotion_concurrency["cancel-in-progress"] !== undefined) {
		violations.push("Queued release promotion must never be cancelled in progress.");
	}

	validate_permissions(jobs, violations);
	validate_action_pins([workflow, setup_action], violations);
	validate_artifact_uploads(jobs, violations);

	if (forbidden_surface.test(JSON.stringify(input))) {
		violations.push("Workflow configuration contains an unsupported publication surface.");
	}

	require_equal_list(input.workflow_files, ["ci.yml"], "workflow files", violations);

	return Object.freeze(violations);
}

function validate_permissions(
	jobs: Readonly<Record<string, unknown>>,
	violations: Array<string>,
): void {
	for (const [job_id, value] of Object.entries(jobs)) {
		const job = require_record(value, `job ${job_id}`, violations);
		const permissions = optional_record(job.permissions) ?? {};
		const serialized = JSON.stringify(job);
		const can_write = Object.values(permissions).includes("write");
		const has_identity = permissions["id-token"] !== undefined;
		const has_secrets = serialized.includes("secrets.");
		const has_environment = job.environment !== undefined;

		if (job_id === "promote") {
			if (
				permissions.contents !== "write" ||
				permissions["id-token"] !== "write" ||
				!has_secrets
			) {
				violations.push(
					"Promotion alone must own write, OIDC, and publishing credentials.",
				);
			}

			continue;
		}

		if (can_write || has_identity || has_secrets || has_environment) {
			violations.push(`${job_id} exceeds read-only verification authority.`);
		}
	}
}

function validate_action_pins(values: ReadonlyArray<unknown>, violations: Array<string>): void {
	const uses_values = values.flatMap(find_uses_values);
	const mutable_action = uses_values.find(
		(value) => !value.startsWith("./") && !/^[^@]+@[a-f0-9]{40}$/.test(value),
	);

	if (mutable_action) {
		violations.push(`External action is not pinned to a full commit: ${mutable_action}.`);
	}
}

function validate_artifact_uploads(
	jobs: Readonly<Record<string, unknown>>,
	violations: Array<string>,
): void {
	for (const value of Object.values(jobs)) {
		const job = optional_record(value);
		const steps = Array.isArray(job?.steps) ? job.steps : [];

		for (const step_value of steps) {
			const step = optional_record(step_value);

			if (!String(step?.uses ?? "").startsWith("actions/upload-artifact@")) {
				continue;
			}

			const with_options = optional_record(step?.with) ?? {};
			const path = String(with_options.path ?? "");

			if (path.startsWith(".")) {
				violations.push(`Artifact upload path must be non-hidden: ${path}.`);
			}

			if (with_options.overwrite !== undefined) {
				violations.push("Artifact uploads must never replace an existing artifact ID.");
			}
		}
	}
}

function find_uses_values(value: unknown): ReadonlyArray<string> {
	if (Array.isArray(value)) {
		return value.flatMap(find_uses_values);
	}

	const record = optional_record(value);

	if (!record) {
		return [];
	}

	return [
		...(typeof record.uses === "string" ? [record.uses] : []),
		...Object.values(record).flatMap(find_uses_values),
	];
}

function require_branch_trigger(
	triggers: Readonly<Record<string, unknown>>,
	name: "pull_request" | "push",
	violations: Array<string>,
): void {
	const trigger = require_record(triggers[name], `workflow.on.${name}`, violations);
	const branches = Array.isArray(trigger.branches) ? trigger.branches : [];

	require_equal_list(branches, ["master"], `${name} branches`, violations);

	if (trigger.tags !== undefined) {
		violations.push(`${name} must not include tag triggers.`);
	}
}

function require_need(
	job: Readonly<Record<string, unknown>>,
	dependency: string,
	label: string,
	violations: Array<string>,
): void {
	const needs = Array.isArray(job.needs) ? job.needs : [job.needs].filter(Boolean);

	if (!needs.includes(dependency)) {
		violations.push(`${label} must depend on ${dependency}.`);
	}
}

function require_job(
	jobs: Readonly<Record<string, unknown>>,
	id: string,
	violations: Array<string>,
): Readonly<Record<string, unknown>> {
	return require_record(jobs[id], `job ${id}`, violations);
}

function require_record(
	value: unknown,
	label: string,
	violations: Array<string>,
): Readonly<Record<string, unknown>> {
	const record = optional_record(value);

	if (!record) {
		violations.push(`${label} must be an object.`);

		return {};
	}

	return record;
}

function optional_record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}

function require_equal_list(
	actual: ReadonlyArray<unknown>,
	expected: ReadonlyArray<unknown>,
	label: string,
	violations: Array<string>,
): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		violations.push(
			`${label} must be ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`,
		);
	}
}

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const workflow_path = process.argv[2] ?? ".github/workflows/ci.yml";
	const workflow_dir = path.dirname(workflow_path);
	const [workflow_source, setup_source, workflow_files] = yield* Effect.all(
		[
			file_system.readFileString(workflow_path),
			file_system.readFileString(".github/actions/setup/action.yml"),
			file_system.readDirectory(workflow_dir),
		] as const,
		{ concurrency: "unbounded" },
	);
	const violations = find_workflow_policy_violations({
		workflow: parse(workflow_source),
		setup_action: parse(setup_source),
		workflow_files: workflow_files.sort(),
	});

	if (violations.length > 0) {
		return yield* Effect.fail(new Error(violations.join("\n")));
	}

	yield* Console.log("SER workflow policy verified.");
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
}
