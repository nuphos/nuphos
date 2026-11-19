import { forwardRef, lazy, Suspense } from 'react'

// Monaco is megabytes of script that only the YAML tab and the database query
// inputs use, so it loads with the first editor instead of at launch.
const CodeEditor = lazy(() => import('./CodeEditor'))

export type EditorProps = {
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

export const YamlEditor = forwardRef<YamlEditorHandle, EditorProps>(
  function YamlEditor(props, ref) {
    return (
      <Suspense fallback={<div className={props.className} />}>
        <CodeEditor {...props} ref={ref} language="yaml" ariaLabel="YAML" />
      </Suspense>
    )
  },
)

export const JsonEditor = forwardRef<YamlEditorHandle, EditorProps>(
  function JsonEditor(props, ref) {
    return (
      <Suspense fallback={<div className={props.className} />}>
        <CodeEditor
          {...props}
          ref={ref}
          language="json"
          ariaLabel="JSON"
          minimap={props.minimap ?? false}
        />
      </Suspense>
    )
  },
)
