import { execFile as execute_file_callback } from "node:child_process";
import { promisify } from "node:util";
import { Schema } from "effect";

const PackedManifestSchema = Schema.Struct({ version: Schema.String });
const execute_file = promisify(execute_file_callback);

export async function read_packed_artifact_version(
	artifact_path: string,
	cwd: string,
): Promise<string> {
	const output = await execute_file("tar", ["-xOf", artifact_path, "package/package.json"], {
		cwd,
		maxBuffer: 1_048_576,
		windowsHide: true,
	});
	const manifest = Schema.decodeUnknownSync(PackedManifestSchema)(JSON.parse(output.stdout));

	return manifest.version;
}
