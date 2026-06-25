import {
  DocumentSnapshot,
  import_runtime_module,
  patch_marker,
} from "./svelte-internals.ts";
import { normalize_transform_result } from "./transform-results.ts";
import { create_safe_preprocess } from "./safe-preprocess.ts";
import {
  patch_svelte_compiler_path,
  patch_typescript_code_actions,
  patch_typescript_snapshot_path,
} from "./patches.ts";

export async function bootstrap_language_server() {
  if (DocumentSnapshot.fromDocument[patch_marker]) {
    return;
  }

  const runtime_module = await import_runtime_module("runtime/preprocess.js");

  patch_svelte_compiler_path(create_safe_preprocess(runtime_module.preprocess));
  patch_typescript_snapshot_path({
    transformEffectMarkup: (code, options) =>
      normalize_transform_result(
        runtime_module.transform_markup_effect(code, options.filename),
        code,
        options.filename,
      ),
    transformEffectScript: (code, options) =>
      normalize_transform_result(
        runtime_module.transform_script_effect(code, options.filename),
        code,
        options.filename,
      ),
  });
  patch_typescript_code_actions();
}
