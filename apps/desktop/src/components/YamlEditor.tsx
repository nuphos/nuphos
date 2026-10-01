// Slim Monaco build: `editor.api` carries the typed namespace, `editor.all`
// side-effect-registers the full editor (find widget, folding, bracket
// matching, …), and we add only the YAML grammar plus the JSON language
// service used by database query/change inputs. This keeps unrelated
// ts/css/html language services and their workers out of the bundle.
// The explicit `.js` keeps TypeScript's bundler resolver from mistaking the
// `.api` segment for a file extension and stripping it (it then maps `.js` back
// to the adjacent `editor.api.d.ts`).
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/editor/editor.all.js'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import { jsonDefaults } from 'monaco-editor/esm/vs/language/json/monaco.contribution'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import { applyTheme, THEME_NAME } from './yaml-editor-theme'

// Monaco resolves heavy work (find-across-document, etc.) on a web worker. We
// only ever instantiate the YAML language — which has no dedicated language
// worker — so the generic editor worker is enough for every label. Bundling it
// via Vite's `?worker` import keeps everything local, which matters in the
// packaged Electron app where there is no CDN to fall back to.
declare global {
  // See src/api.ts: merging into the DOM's `Window` requires an interface.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    MonacoEnvironment?: monaco.Environment
  }
}
window.MonacoEnvironment = {
  getWorker: (_moduleId, label) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
}

jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  enableSchemaRequest: false,
})

type EditorProps = {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  className?: string
  minimap?: boolean
  lineNumbers?: 'on' | 'off'
  wordWrap?: 'on' | 'off'
}

export type YamlEditorHandle = {
  openSearchPanel: () => void
}

type CodeEditorProps = EditorProps & {
  language: 'yaml' | 'json'
  ariaLabel: string
}

/**
 * Syntax-highlighted editor used by resource YAML and database JSON inputs. A thin
 * controlled wrapper over Monaco: `value` drives the document, edits are pushed
 * back through `onChange`, and `readOnly` is reconfigured live so the same
 * instance serves both viewing and editing.
 */
const CodeEditor = forwardRef<YamlEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    readOnly = false,
    className,
    language,
    ariaLabel,
    minimap = true,
    lineNumbers = 'on',
    wordWrap = 'off',
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // Suppress the change listener while we push external value updates so the
  // programmatic edit (resource switch, Secret redact/reveal, reload after
  // Apply) never leaks back into the caller's draft.
  const suppressChange = useRef(false)
  // Read the latest onChange without re-mounting the editor on every render.
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useImperativeHandle(
    ref,
    () => ({
      openSearchPanel() {
        const editor = editorRef.current

        if (!editor) return
        editor.focus()
        void editor.getAction('actions.find')?.run()
      },
    }),
    [],
  )

  // Mount once. Subsequent value / readOnly changes are applied via the effects
  // below so the editor (and its undo history, cursor, scroll) is preserved.
  useEffect(() => {
    const host = hostRef.current

    if (!host) return

    applyTheme()
    const editor = monaco.editor.create(host, {
      value,
      language,
      theme: THEME_NAME,
      readOnly,
      // Keep Monaco's hidden input textarea in sync with the editor option.
      // This must be explicit in Electron: a textarea that was created while
      // another Monaco instance was read-only can otherwise retain the DOM
      // `readonly` attribute even though the editor option is writable.
      domReadOnly: readOnly,
      // The editor fills its (fixed-height) container and scrolls internally,
      // which is what keeps the find widget, minimap and hover tooltips
      // correctly positioned. `automaticLayout` tracks container resizes.
      automaticLayout: true,
      minimap: { enabled: minimap },
      lineNumbers,
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      lineHeight: 19,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      folding: true,
      wordWrap,
      smoothScrolling: true,
      padding: { top: 8, bottom: 8 },
      ariaLabel,
    })

    editorRef.current = editor

    editor.onDidChangeModelContent(() => {
      if (suppressChange.current) return
      onChangeRef.current?.(editor.getValue())
    })

    // Re-resolve the theme when the app flips between light and dark.
    const themeObserver = new MutationObserver(applyTheme)

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      themeObserver.disconnect()
      editor.getModel()?.dispose()
      editor.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value changes (switching resource, reloading after Apply,
  // revealing a Secret) without clobbering in-progress local edits — when the
  // change originated here, value already equals the document.
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()

    if (!editor || !model) return
    if (model.getValue() === value) return
    // Use model.setValue so the external swap clears the undo/redo stack — the
    // user must not be able to undo back into a previous resource's content.
    // Capture and restore cursor/scroll so the swap stays visually seamless.
    suppressChange.current = true
    const selection = editor.getSelection()
    const scrollTop = editor.getScrollTop()
    const scrollLeft = editor.getScrollLeft()

    model.setValue(value)
    if (selection) editor.setSelection(selection)
    editor.setScrollTop(scrollTop)
    editor.setScrollLeft(scrollLeft)
    suppressChange.current = false
  }, [value])

  // Toggle editability live (Secret redaction / read-only Helm storage).
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, domReadOnly: readOnly })
  }, [readOnly])

  // `position: relative` is required: Monaco renders the find-widget button
  // tooltips (and other context-view overlays) as `position: absolute` children
  // of this host. Without a positioned host they resolve their offset parent to
  // <body> and Monaco's host-relative `top` sends them to the top of the page.
  return <div ref={hostRef} className={className} style={{ position: 'relative' }} />
})

export const YamlEditor = forwardRef<YamlEditorHandle, EditorProps>(
  function YamlEditor(props, ref) {
    return <CodeEditor {...props} ref={ref} language="yaml" ariaLabel="YAML" />
  },
)

export const JsonEditor = forwardRef<YamlEditorHandle, EditorProps>(
  function JsonEditor(props, ref) {
    return (
      <CodeEditor
        {...props}
        ref={ref}
        language="json"
        ariaLabel="JSON"
        minimap={props.minimap ?? false}
      />
    )
  },
)
