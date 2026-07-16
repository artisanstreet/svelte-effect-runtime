import { find_workflow_policy_violations } from "../../../build/ci/workflow-policy.ts";
import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";

test("the authoritative workflow preserves release safety and exact artifact promotion", async () => {
	const [workflow_source, setup_source, workflow_files] = await Promise.all([
		readFile(".github/workflows/ci.yml", "utf8"),
		readFile(".github/actions/setup/action.yml", "utf8"),
		readdir(".github/workflows"),
	]);
	const violations = find_workflow_policy_violations({
		workflow: parse(workflow_source),
		setup_action: parse(setup_source),
		workflow_files,
	});

	expect(violations).toEqual([]);
});

test("remote transport retains conformance evidence after failures", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const steps = workflow.jobs.capability_transport.steps as ReadonlyArray<{
		readonly if?: string;
		readonly name?: string;
		readonly uses?: string;
		readonly with?: Record<string, unknown>;
	}>;
	const collect_step = steps.find((step) => step.name === "Collect conformance evidence");
	const upload_step = steps.find((step) => step.name === "Upload conformance evidence");

	expect(collect_step?.if).toBe("always() && !cancelled()");
	expect(upload_step?.if).toBe("always() && !cancelled()");
	expect(upload_step?.uses).toMatch(/^actions\/upload-artifact@[a-f0-9]{40}$/);
	expect(upload_step?.with).toMatchObject({
		"if-no-files-found": "ignore",
		name: "conformance-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}",
		path: "conformance-evidence",
	});
});

test("resume reruns candidate smoke jobs after skipped artifact builds", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));

	for (const job_id of ["candidate_consumer_smoke", "candidate_browser_smoke"]) {
		const condition = workflow.jobs[job_id].if as string;

		expect(condition).toContain("always()");
		expect(condition).toContain("needs.plan.result == 'success'");
		expect(condition).toContain("needs.candidate_assemble.result == 'success'");
	}
});

test("resume pins the release plan to the preserved commit", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const resume_step = workflow.jobs.plan.steps.find(
		(step: { readonly name?: string }) => step.name === "Plan exact resume",
	);

	expect(resume_step.run).toContain('--commit "$RESUME_COMMIT"');
	expect(resume_step.run).toContain('--execution-commit "${{ github.sha }}"');
	expect(resume_step.env.RESUME_COMMIT).toBe("${{ inputs.resume_commit }}");
});

test("workflow policy rejects a master publication path", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.github_prepare.if = "github.ref == 'refs/heads/master'";

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("github_prepare must be gated on a manual candidate dispatch.");
});

test("workflow policy requires candidate history for the dry-run promotion proof", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));
	const checkout = workflow.jobs.dry_run.steps.find(
		(step: { readonly name?: string }) => step.name === "Checkout selected commit",
	);

	checkout.with["fetch-depth"] = 1;

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("Dry-run must fetch candidate history before promotion checks.");
});

test("workflow policy reads the candidate guard from the job condition", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.github_prepare.if = "true";
	workflow.jobs.github_prepare.env = {
		UNRELATED_PROOF: "workflow_dispatch refs/heads/candidate",
	};

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("github_prepare must be gated on a manual candidate dispatch.");
});

test("workflow policy rejects a widened candidate guard", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.github_prepare.if = `${workflow.jobs.github_prepare.if} || true`;

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("github_prepare must be gated on a manual candidate dispatch.");
});

test("workflow policy rejects extra publication authority", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.npm_publish.permissions.packages = "write";

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("npm publication must use only read access and OIDC authority.");
});

test("workflow policy requires GitHub-hosted npm trusted publishing", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.npm_publish["runs-on"] = "blacksmith-4vcpu-ubuntu-2404";

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("npm trusted publishing must run on a GitHub-hosted runner.");
});

test("workflow policy rejects direct shell interpolation of manual inputs", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.plan.steps.push({ run: 'echo "${{ inputs.resume_commit }}"' });

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("plan interpolates manual input directly into a shell script.");
});
