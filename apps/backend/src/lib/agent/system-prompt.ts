// Agent prompts are versioned in this repo — every system message that goes
// to the model ships with the backend, so a prompt change and the code it
// depends on land in the same release. Edit the files under ./prompts/.
// (They used to live on Braintrust behind a 60s TTL, which let prompt and
// backend drift apart across a deploy window.)
import { readFileSync, statSync } from 'node:fs'

import { logEvent } from '@/lib/observability'

export type ResolvedPrompt = {
  prompt: string
  source: 'repo'
  slug: string
  version?: string
}

const SYSTEM_PROMPT_FILE = 'atlas-agent-system.md'

// Keyed on the file's mtime, not just its name. A prompt is a plain .md, so
// `bun --hot` never reloads one — editing a prompt and seeing no change until
// the process is restarted (or until some unrelated .ts edit happened to reset
// this map) was a standing local-dev trap. A stat per turn costs nothing next
// to the model call it feeds.
const templates = new Map<string, { mtimeMs: number; text: string }>()

// `dir` exists so tests can exercise THIS function against a scratch directory
// rather than reimplementing the mtime rule and asserting against the copy.
export function loadTemplate(file: string, dir?: URL): string {
  const url = dir ? new URL(file, dir) : new URL(`./prompts/${file}`, import.meta.url)
  const cached = templates.get(file)
  let mtimeMs: number

  try {
    mtimeMs = statSync(url).mtimeMs
  } catch {
    // Unreadable stat (a packaged/read-only deploy): trust whatever is cached,
    // and otherwise fall through to the read, which reports the real error.
    if (cached) return cached.text
    mtimeMs = 0
  }
  if (cached && cached.mtimeMs === mtimeMs) return cached.text
  const text = readFileSync(url, 'utf-8')

  templates.set(file, { mtimeMs, text })

  return text
}

export function clearSystemPromptCache() {
  templates.clear()
}

/**
 * Mustache-compatible with the Braintrust-hosted prompts this replaced:
 * `{{key}}` renders the value, an unknown placeholder renders empty.
 * `mustRender` names the load-bearing placeholders — an edit that drops one
 * (so the model would silently lose e.g. its output-token budget) must show
 * up in error logs.
 */
export function renderPromptTemplate(
  file: string,
  template: string,
  vars: Record<string, string | number>,
  mustRender: string[] = [],
): string {
  const missing = mustRender.filter((key) => !template.includes(`{{${key}}}`))

  if (missing.length) {
    logEvent('error', 'agent.prompt.missing_template_variable', {
      file,
      variables: missing.join(','),
    })
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''))
}

export async function getSystemPrompt(
  locale: string,
  vars: Record<string, string | number> = {},
): Promise<ResolvedPrompt> {
  const template = loadTemplate(SYSTEM_PROMPT_FILE)

  return {
    prompt: renderPromptTemplate(SYSTEM_PROMPT_FILE, template, { locale, ...vars }, [
      'max_output_tokens',
    ]),
    source: 'repo',
    slug: SYSTEM_PROMPT_FILE,
  }
}
