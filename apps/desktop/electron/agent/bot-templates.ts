import { app } from 'electron'
import { strToU8, zipSync } from 'fflate'

import type { BotTemplate } from '../../src/api/bot-import-types'

// Templates live in the public nuphos/bot-templates repository and are read from it
// each time, so a template merged there shows up without an app update.
const REPOSITORY = 'https://raw.githubusercontent.com/nuphos/bot-templates/main'
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER = /^\d+\.\d+\.\d+$/
const MAX_BYTES = 1024 * 1024
const PROVIDER_NAMES: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear',
  jira: 'Jira',
  notion: 'Notion',
  slack: 'Slack',
  google: 'Google Workspace',
}

/** A development build can read a local checkout instead, to try a template before it is merged. */
function repository() {
  const local = app.isPackaged ? undefined : process.env.NUPHOS_BOT_TEMPLATES_URL?.trim()
  const base = local ? local : REPOSITORY

  return base.endsWith('/') ? base.slice(0, -1) : base
}

async function download(path: string) {
  const response = await fetch(`${repository()}/${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)

  if (!response?.ok)
    throw new Error('Could not load Bot templates. Check your connection and try again.')
  const text = await response.text()

  if (text.length > MAX_BYTES) throw new Error('This template is too large to import.')

  return text
}

type Fields = Record<string, unknown>

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const lines = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 10 && value.every((line) => text(line, 300))
const fields = (value: unknown): value is Fields =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function readIntegration(item: unknown): BotTemplate['integrations'][number] | null {
  if (!fields(item) || !text(item.provider, 64) || !text(item.reason, 1000)) return null
  if (typeof item.required !== 'boolean') return null

  return {
    name: PROVIDER_NAMES[item.provider] ?? item.provider,
    required: item.required,
    reason: item.reason,
  }
}

function readCard(entry: Fields) {
  const { id, version, name, category, avatar, summary, highlights, examples } = entry
  const author = fields(entry.author) ? entry.author.name : undefined

  if (!text(id, 64) || !KEY.test(id) || !text(version, 50) || !SEMVER.test(version)) return null
  if (!text(name, 120) || !text(author, 80) || !text(category, 60)) return null
  if (!text(avatar, 100) || !text(summary, 300) || !lines(highlights) || !lines(examples))
    return null

  return { id, version, name, author, category, avatar, summary, highlights, examples }
}

/** Keeps only well-formed entries: one bad template must not hide the others. */
function readEntry(raw: unknown): BotTemplate | null {
  if (!fields(raw) || !Array.isArray(raw.requirements)) return null
  const card = readCard(raw)
  const integrations = raw.requirements.map(readIntegration)

  if (!card || integrations.includes(null)) return null

  return {
    ...card,
    official: raw.official === true,
    featured: raw.featured === true,
    integrations: integrations.filter((item) => item !== null),
  }
}

export async function listBotTemplates(): Promise<BotTemplate[]> {
  let catalog: unknown

  try {
    catalog = JSON.parse(await download('catalog.json'))
  } catch (cause) {
    if (cause instanceof SyntaxError)
      throw new Error('The Bot template list could not be read.', { cause })
    throw cause
  }
  const entries = (catalog as { templates?: unknown })?.templates

  if (!Array.isArray(entries)) throw new Error('The Bot template list could not be read.')

  return entries.map(readEntry).filter((entry): entry is BotTemplate => entry !== null)
}

/** The template as a Bot bundle ZIP, the format the import route reads. */
export async function botTemplateBundle(id: string): Promise<Buffer> {
  if (!KEY.test(id) || id.length > 64) throw new Error('This template is unavailable.')
  const manifest = await download(`templates/${id}/manifest.json`)
  let parsed: { source?: { templateId?: unknown }; bots?: unknown[] }

  try {
    parsed = JSON.parse(manifest)
  } catch (cause) {
    throw new Error('This template could not be read.', { cause })
  }
  if (parsed.source?.templateId !== id || parsed.bots?.length !== 1)
    throw new Error('This template could not be read.')

  return Buffer.from(zipSync({ 'manifest.json': strToU8(manifest) }))
}
