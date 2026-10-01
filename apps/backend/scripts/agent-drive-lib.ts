export type Args = {
  user?: string
  message?: string
  team?: string
  session?: string
  creds?: string
  base?: string
  require: string[]
  forbid: string[]
  quiet: boolean
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { require: [], forbid: [], quiet: false }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = () => {
      const next = argv[++i]

      if (next === undefined) fail(`${flag} needs a value`)

      return next!
    }

    switch (flag) {
      case '--user':
        args.user = value()
        break
      case '--message':
      case '-m':
        args.message = value()
        break
      case '--team':
        args.team = value()
        break
      case '--session':
        args.session = value()
        break
      case '--creds':
        args.creds = value()
        break
      case '--base':
        args.base = value()
        break
      case '--require':
        args.require.push(value())
        break
      case '--forbid':
        args.forbid.push(value())
        break
      case '--quiet':
        args.quiet = true
        break
      default:
        fail(`unknown flag ${flag}`)
    }
  }

  return args
}

export function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const CREDS_PRESETS: Record<string, (keyof CredentialOptions)[]> = {
  // Every provider that can carry a Kubernetes cluster — the selection needs,
  // and the one most cluster work wants.
  k8s: [
    'awsRoles',
    'gcpServiceAccounts',
    'tencentAccounts',
    'aliyunAccounts',
    'linodeAccounts',
    'volcengineAccounts',
    'azureAccounts',
  ],
  none: [],
}

type CredentialOptions = {
  awsRoles: { roleId: string }[]
  gcpServiceAccounts: { serviceAccountId: string }[]
  tencentAccounts: { accountId: string }[]
  aliyunAccounts: { accountId: string }[]
  linodeAccounts: { accountId: string }[]
  volcengineAccounts: { accountId: string }[]
  azureAccounts: { accountId: string }[]
}

const SELECTION_KEY: Record<string, string> = {
  awsRoles: 'awsRoleIds',
  gcpServiceAccounts: 'gcpServiceAccountIds',
  tencentAccounts: 'tencentAccountIds',
  aliyunAccounts: 'aliyunAccountIds',
  linodeAccounts: 'linodeAccountIds',
  volcengineAccounts: 'volcengineAccountIds',
  azureAccounts: 'azureAccountIds',
}

/** The id field is named per provider; take whichever one the entry carries. */
function entryId(entry: Record<string, unknown>): string | null {
  for (const key of ['roleId', 'serviceAccountId', 'accountId']) {
    const value = entry[key]

    if (typeof value === 'string') return value
  }

  return null
}

export async function resolveCredentialAccess(
  base: string,
  token: string,
  teamId: string,
  preset: string,
): Promise<Record<string, string[]> | undefined> {
  const groups = CREDS_PRESETS[preset]

  if (!groups) fail(`--creds must be one of: ${Object.keys(CREDS_PRESETS).join(', ')}`)
  if (groups.length === 0) return undefined

  const res = await fetch(`${base}/agent/credential-options?teamId=${teamId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) fail(`credential-options returned HTTP ${res.status}: ${await res.text()}`)
  const options = (await res.json()) as Record<string, Record<string, unknown>[]>

  const selection: Record<string, string[]> = {}

  for (const group of groups) {
    const ids = (options[group] ?? []).map(entryId).filter((id): id is string => Boolean(id))

    if (ids.length > 0) selection[SELECTION_KEY[group]!] = ids
  }

  return selection
}

export type Trace = {
  text: string
  tools: { name: string; input: string }[]
  errors: string[]
  /** The model ended the turn cleanly (`atlas-turn-complete`). */
  completed: boolean
  /** The turn hit the step or token cap and wants to continue (`atlas-turn-paused`). */
  paused: boolean
}

/**
 * Consume the UI message stream, printing as it goes. Tool inputs stream in as
 * deltas, so they are accumulated per call id and reported once complete —
 * printing partial JSON would make the trace unassertable.
 */
export async function consume(res: Response, quiet: boolean): Promise<Trace> {
  const trace: Trace = { text: '', tools: [], errors: [], completed: false, paused: false }
  const pendingInput = new Map<string, string>()
  const toolName = new Map<string, string>()

  const reader = res.body?.getReader()

  if (!reader) fail('response had no body')
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')

    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()

      if (!payload || payload === '[DONE]') continue
      let part: Record<string, unknown>

      try {
        part = JSON.parse(payload) as Record<string, unknown>
      } catch {
        continue
      }
      const type = String(part.type ?? '')

      if (type === 'text-delta') {
        const delta = String(part.delta ?? '')

        trace.text += delta
        if (!quiet) process.stdout.write(delta)
        continue
      }
      if (type === 'tool-input-start') {
        const id = String(part.toolCallId ?? '')

        toolName.set(id, String(part.toolName ?? '?'))
        pendingInput.set(id, '')
        continue
      }
      if (type === 'tool-input-delta') {
        const id = String(part.toolCallId ?? '')

        pendingInput.set(id, (pendingInput.get(id) ?? '') + String(part.inputTextDelta ?? ''))
        continue
      }
      if (type === 'tool-input-available' || type === 'tool-call') {
        const id = String(part.toolCallId ?? '')
        const name = String(part.toolName ?? toolName.get(id) ?? '?')
        const input =
          part.input !== undefined ? JSON.stringify(part.input) : (pendingInput.get(id) ?? '')

        trace.tools.push({ name, input })
        pendingInput.delete(id)
        if (!quiet) process.stdout.write(`\n  ⚙ ${name} ${truncate(input, 400)}\n`)
        continue
      }
      if (type === 'tool-output-available') {
        const output = typeof part.output === 'string' ? part.output : JSON.stringify(part.output)

        if (!quiet) process.stdout.write(`  ← ${truncate(output, 600)}\n`)
        continue
      }
      if (type === 'tool-output-error') {
        const message = String(part.errorText ?? 'tool failed')

        trace.errors.push(message)
        process.stdout.write(`  ✗ tool error: ${truncate(message, 400)}\n`)
        continue
      }
      if (type === 'error') {
        const message = String(part.errorText ?? part.error ?? 'unknown error')

        trace.errors.push(message)
        process.stdout.write(`\n  ✗ stream error: ${message}\n`)
        continue
      }
      // The backend does not emit the AI SDK's `finish` part. It emits its own
      // terminal frames, and the distinction matters: turn-complete means the
      // model chose to stop, turn-paused means a step/token cap tripped, and
      // neither arriving means the stream died on us.
      if (type === 'atlas-turn-complete') trace.completed = true
      if (type === 'atlas-turn-paused') trace.paused = true
    }
  }

  return trace
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ')

  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
