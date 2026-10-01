import yaml from 'js-yaml'

export type K8sYamlObject = {
  apiVersion?: string
  kind?: string
  type?: string
  immutable?: boolean
  data?: Record<string, unknown>
  binaryData?: Record<string, unknown>
  stringData?: Record<string, unknown>
  metadata?: {
    namespace?: string
    creationTimestamp?: string
    labels?: Record<string, unknown>
    annotations?: Record<string, unknown>
  }
}

export type KeyEntry = {
  id: string
  key: string
  source: 'data' | 'binaryData' | 'stringData'
  size: string
  preview?: string
  copyValue?: string
  editValue?: string
  editable: boolean
  removable: boolean
}

export type KeyDraft = {
  title: string
  key: string
  value: string
  submitLabel: string
  original?: KeyEntry
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)

    return
  }
  const textarea = document.createElement('textarea')

  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export function decodeSecretText(value: string): string | null {
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))

    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function decodedSecretByteLength(value: string): number {
  try {
    return atob(value).length
  } catch {
    return 0
  }
}

export function parseK8sYamlObject(text: string): K8sYamlObject {
  try {
    const loaded = yaml.load(text)

    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      return loaded
    }
  } catch {
    // Keep the detail view usable even if kubectl returns unusual YAML.
  }

  return {}
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}

  for (const [key, raw] of Object.entries(value)) {
    if (raw == null) continue
    out[key] = String(raw)
  }

  return out
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function previewValue(value: string): string {
  const firstLine = value.replace(/\s+/g, ' ').trim()

  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}...` : firstLine
}

export function parseYamlSummary(yamlText: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const lines = yamlText.split('\n')

  for (const k of ['kind', 'apiVersion']) {
    const line = lines.find((l) => l.startsWith(`${k}:`))

    if (line) out.push({ label: k, value: line.slice(k.length + 1).trim() })
  }

  return out
}
