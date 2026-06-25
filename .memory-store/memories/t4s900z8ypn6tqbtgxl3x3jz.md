+++
schema = "memorystore.note/v1"
key = "t4s900z8ypn6tqbtgxl3x3jz"
tags = [
    "language-server",
    "debugging",
    "svelte-effect-runtime",
    "preprocess",
]
created_at = "2026-06-25T13:15:47.2762749Z"
updated_at = "2026-06-25T13:15:47.2762749Z"
+++
On 2026-06-25, invalid SER client script code such as `yield*` inside `$derived.by()` was verified to throw from `transform_script_effect` through the Svelte language-server virtual-document path, which can terminate the Svelte LSP. The fix is LSP-scoped: `prepare_virtual_document` now runs runtime transforms through safe wrappers, script transform failures become a virtual TypeScript `never` diagnostic containing the original SER message, and the compiler preprocessor injection uses `create_safe_preprocess` to return original source instead of bubbling runtime transform errors. Production/runtime preprocess behavior still throws for invalid SER code.