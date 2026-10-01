// Monaco's editor feature bundle and per-language grammars are side-effect-only
// JS modules with no shipped type declarations. We import them purely for their
// registration side effects (see YamlEditor.tsx), so declare them as opaque
// modules to keep TypeScript from trying to type-check Monaco's internals.
declare module 'monaco-editor/esm/vs/editor/editor.all.js'
declare module 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
declare module 'monaco-editor/esm/vs/language/json/monaco.contribution' {
  export const jsonDefaults: {
    setDiagnosticsOptions(options: {
      validate?: boolean
      allowComments?: boolean
      enableSchemaRequest?: boolean
    }): void
  }
}
