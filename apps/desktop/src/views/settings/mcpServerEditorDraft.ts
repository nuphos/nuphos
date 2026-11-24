import type { McpServerInput, TeamMcpServer } from '../../types/mcp-servers'

/** `null` is closed, `'new'` adds one, a server edits it. */
export type McpServerEditorTarget = TeamMcpServer | 'new' | null

export type HeaderRow = { name: string; value: string; saved: boolean }
export type Draft = { name: string; url: string; headers: HeaderRow[] }

export function draftOf(target: McpServerEditorTarget): Draft {
  if (target === null || target === 'new') {
    return { name: '', url: 'https://', headers: [] }
  }

  return {
    name: target.name,
    url: target.url,
    headers: target.headers.map((name) => ({ name, value: '', saved: true })),
  }
}

/**
 * Update the draft URL. When editing an existing server and the URL changes from
 * its saved value, drop all saved headers so secrets are never carried over to
 * a different endpoint (matching backend PATCH rules).
 */
export function updateDraftUrl(draft: Draft, nextUrl: string, originalUrl?: string): Draft {
  const urlChanged = originalUrl !== undefined && nextUrl.trim() !== originalUrl

  return {
    ...draft,
    url: nextUrl,
    headers: urlChanged ? draft.headers.filter((h) => !h.saved) : draft.headers,
  }
}

/**
 * What to send: a saved header left blank keeps its stored value while the URL
 * is unchanged. If the URL changed, blank saved headers are never carried over.
 */
export function inputOf(draft: Draft, originalUrl?: string): McpServerInput {
  const trimmedUrl = draft.url.trim()
  const urlChanged = originalUrl !== undefined && trimmedUrl !== originalUrl

  return {
    name: draft.name.trim(),
    url: trimmedUrl,
    headers: draft.headers
      .filter((h) => h.name.trim() && !(urlChanged && h.saved && !h.value))
      .map((h) => ({
        name: h.name.trim(),
        ...(h.value || !h.saved ? { value: h.value } : {}),
      })),
  }
}
