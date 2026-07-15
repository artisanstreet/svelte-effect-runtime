import { capability_lane_ids, get_capability_lane } from "./capabilities.ts";
import { CommandName, RepoRoot, RunCommand } from "../node-utils.ts";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";

export const RunCapabilityLane = (lane_id: string) =>
	Effect.gen(function* () {
		const repo_root = yield* RepoRoot;
		const corepack = yield* CommandName("corepack");
		const lane = get_capability_lane(lane_id);

		yield* RunCommand(corepack, lane.test_command.args, repo_root, { inherit: true });

		for (const command of lane.commands) {
			yield* RunCommand(corepack, command.args, repo_root, { inherit: true });
		}
	});

const Main = Effect.gen(function* () {
	const lane_id = process.argv[2];

	if (!lane_id) {
		return yield* Effect.fail(
			new Error(`Capability runner requires one of ${capability_lane_ids.join(", ")}.`),
		);
	}

	yield* RunCapabilityLane(lane_id);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
}
