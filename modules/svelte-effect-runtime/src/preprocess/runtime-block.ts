/**
 * Builds the runtime block appended to lowered script effect code.
 *
 * @since 2.0.0
 * @param assignments - Effect-body assignment strings.
 * @returns Full `Effect.gen` plus `onMount` block.
 */
export function make_runtime_block(assignments: string[]): string {
  const body = assignments
    .map((assignment) => `  ${assignment}`)
    .join("\n");

  return [
    "",
    "const __SER__program = Effect.gen(function* () {",
    body,
    "});",
    "",
    "onMount(() => {",
    "  const __SER__dispatcher = get_dispatcher();",
    "  const __SER__cancel = __SER__dispatcher.fork(__SER__program);",
    "  import.meta.hot?.dispose(__SER__cancel);",
    "  return __SER__cancel;",
    "});",
    "",
  ].join("\n");
}
