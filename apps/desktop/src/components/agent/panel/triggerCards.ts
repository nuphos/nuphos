import type { Part, ToolPart } from './parts.ts'

const OBJECT_ID = /^[\da-f]{24}$/i
const ID_FIELD = /"id"\s*:\s*"([\da-f]{24})"/i
const TYPE_FIELD = /"triggerType"\s*:\s*"(\w+)"/
// Agent runtimes with bound trigger tools call them by these names.
const TRIGGER_TOOL = /(^|__|: )trigger_(create|update)$/
const COMMAND_TOOLS = new Set(['bash', 'Bash', 'Terminal', 'local_exec'])

export type TriggerCardInfo = { triggerId: string; action: 'created' | 'updated' }

function unquote(token: string): string {
  return token.replace(/^['"]|['"]$/g, '')
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output === undefined || output === null) return ''
  const stdout = (output as { stdout?: unknown }).stdout

  return typeof stdout === 'string' ? stdout : JSON.stringify(output)
}

// `trigger-api.sh <team> POST '' @body` creates; `PATCH <id> @body` updates.
// Sub-routes (test-fire, groups, finalize-wiring) are not a trigger's settings.
function scriptCall(command: string): { action: TriggerCardInfo['action']; path: string } | null {
  if (!command.includes('trigger-api.sh')) return null
  const tokens = command.split(/\s+/).map(unquote)

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const path = tokens[i + 1]

    if (path.includes('/')) continue
    if (tokens[i] === 'POST' && path === '') return { action: 'created', path }
    if (tokens[i] === 'PATCH' && path) return { action: 'updated', path }
  }

  return null
}

// The script prints the trigger it wrote; a webhook trigger has no schedule to show.
function triggerInOutput(output: unknown): { id: string | null; cron: boolean } {
  const text = outputText(output)
  const type = TYPE_FIELD.exec(text)?.[1]

  return { id: ID_FIELD.exec(text)?.[1] ?? null, cron: !type || type === 'cron' }
}

function commandCard(input: unknown, fromOutput: string | null): TriggerCardInfo | null {
  const command = (input as { command?: unknown } | undefined)?.command
  const call = typeof command === 'string' ? scriptCall(command) : null

  if (!call) return null
  // A stored transcript may have kept the command but not the output.
  const triggerId = fromOutput ?? (OBJECT_ID.test(call.path) ? call.path : null)

  return triggerId ? { triggerId, action: call.action } : null
}

/** A tool call that created or changed a cron trigger, and which one. */
export function triggerCardInfo(part: ToolPart): TriggerCardInfo | null {
  if (part.state !== 'output-available') return null
  const { id: fromOutput, cron } = triggerInOutput(part.output)

  if (!cron) return null
  const bound = TRIGGER_TOOL.exec(part.toolName)

  if (bound) {
    const action = bound[2] === 'create' ? 'created' : 'updated'

    return fromOutput ? { triggerId: fromOutput, action } : null
  }

  return COMMAND_TOOLS.has(part.toolName) ? commandCard(part.input, fromOutput) : null
}

export function isTriggerCardPart(part: Part): boolean {
  return part.type === 'tool' && triggerCardInfo(part) !== null
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "in 25 min", "in 3 h", then "tomorrow" or "in 4 days" by the calendar: how far off a run is. */
export function untilRun(at: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((at.getTime() - now.getTime()) / 60_000))

  if (minutes < 60) return `in ${String(minutes)} min`
  if (minutes < 12 * 60) return `in ${String(Math.round(minutes / 60))} h`
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000)

  if (days <= 0) return 'later today'

  return days === 1 ? 'tomorrow' : `in ${String(days)} days`
}
