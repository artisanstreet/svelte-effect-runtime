export const highlights_query = String
  .raw`; Highlight the SER-only effect marker on <script effect>.
((script_element
  (start_tag
    (attribute
      (attribute_name) @storage.modifier.effect.ser)))
  (#eq? @storage.modifier.effect.ser "effect"))

; Highlight yielded Effect expressions after TypeScript has been injected.
(yield_expression
  "*" @keyword.operator.yield.star.ser) @keyword.control.yield.ser

; Highlight bare SER declaration tags such as {const value = yield* load()}.
((expression) @meta.embedded.declaration.ser
  (#match? @meta.embedded.declaration.ser "^\\s*(const|let)\\s"))
`;

export const injections_query = String
  .raw`; Treat <script lang="ts" effect> as TypeScript just like stock Svelte script tags.
((script_element
  (start_tag
    (attribute
      (attribute_name) @_lang_name
      (quoted_attribute_value
        (attribute_value) @_lang_value))
    (attribute
      (attribute_name) @_effect_name))
  (raw_text) @injection.content)
  (#eq? @_lang_name "lang")
  (#any-of? @_lang_value "ts" "typescript")
  (#eq? @_effect_name "effect")
  (#set! injection.language "typescript"))

; Inject TypeScript into SER markup expressions that stock queries may not see.
((expression) @injection.content
  (#match? @injection.content "^\\s*(yield\\s*\\*|(const|let)\\s|[#@:](each|await|if|key|else\\s+if|render|html|debug|const)\\b)")
  (#set! injection.language "typescript"))
`;
