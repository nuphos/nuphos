import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { kubectlArgs } from './kubectl-command'
import { parseLoginStep } from './runtime-login-step'

import type { RuntimeLoginFrame } from './runtime-login-step'

const ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount'

const LOGIN_ERRORS = new Map<unknown, string>([
  [
    'input_unavailable',
    'This agent cannot receive the sign-in code. Update its image, or run `claude auth login` inside the container.',
  ],
  ['failed', 'Sign-in did not complete. Start again and paste the whole code Claude shows you.'],
])

/** Claude's own authorize page, and nothing a runtime could substitute for it. */
export function isClaudeAuthorizeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    const url = new URL(value)

    return (
      url.protocol === 'https:' &&
      ['claude.com', 'claude.ai'].includes(url.hostname) &&
      url.pathname.endsWith('/oauth/authorize')
    )
  } catch {
    return false
  }
}

/** Google's authorize page, as Antigravity's sign-in opens it. */
export function isGoogleAuthorizeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    const url = new URL(value)

    return (
      url.protocol === 'https:' &&
      url.hostname === 'accounts.google.com' &&
      url.pathname === '/o/oauth2/v2/auth'
    )
  } catch {
    return false
  }
}

/** The device pages a runtime may send a user to: ChatGPT for Codex, xAI for Grok Build. */
const DEVICE_VERIFICATION_URIS = new Set([
  'https://auth.openai.com/codex/device',
  'https://accounts.x.ai/oauth2/device',
])

/**
 * Bounded private stream parser; unknown or malformed frames never reach the UI.
 *
 * The runtime keeps the credential it signs in with, so an `authenticated` frame that
 * offers one anyway is a runtime handing over what nobody asked it for.
 */
export function loginFrameReader(
  onFrame: (frame: RuntimeLoginFrame) => void,
  // The provider's own advice when its sign-in fails.
  failed = LOGIN_ERRORS.get('failed'),
  // Whether this runtime may ask the user in steps (OpenCode).
  steps = false,
) {
  let pending = ''

  return (chunk: string) => {
    pending += chunk
    if (pending.length > 128 * 1024) throw new Error('Invalid login response')
    let newline: number

    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline)

      pending = pending.slice(newline + 1)
      if (!line.trim()) continue
      const frame = JSON.parse(line) as Record<string, unknown>
      const step = steps ? parseLoginStep(frame) : undefined

      if (step) onFrame({ type: 'step', step })
      else if (
        frame.type === 'device' &&
        DEVICE_VERIFICATION_URIS.has(frame.verificationUri as string) &&
        typeof frame.userCode === 'string' &&
        /^[A-Za-z0-9-]{4,32}$/u.test(frame.userCode)
      ) {
        onFrame({
          type: 'device',
          verificationUri: frame.verificationUri as string,
          userCode: frame.userCode,
        })
      } else if (
        frame.type === 'authorize' &&
        (isClaudeAuthorizeUrl(frame.url) || isGoogleAuthorizeUrl(frame.url))
      ) {
        onFrame({ type: 'authorize', url: frame.url })
      } else if (frame.type === 'authenticated' && frame.authJson === undefined) {
        onFrame({ type: 'authenticated' })
      } else if (frame.type === 'error') {
        onFrame({
          type: 'error',
          message:
            (frame.reason === 'failed' ? failed : LOGIN_ERRORS.get(frame.reason)) ??
            'Sign-in did not complete. Retry and check device-code login in ChatGPT security settings.',
        })
      } else throw new Error('Invalid login response')
    }
  }
}

function kubectlLogin(
  namespace: string,
  deployment: string,
  command: readonly string[],
  onOutput: (chunk: string) => void,
  signal: AbortSignal,
  input?: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Fixed command and server-derived placement; no shell or client-supplied args.

    const child = spawn(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- operator-configured kubectl for local development
      'kubectl',
      kubectlArgs([
        '-n',
        namespace,
        'exec',
        ...(input ? ['-i'] : []),
        `deployment/${deployment}`,
        '-c',
        'openab',
        '--',
        ...command,
      ]),
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        signal,
      },
    )

    child.stdin.on('error', () => {
      reject(new Error('Runtime input interrupted'))
    })
    child.stdin.end(input)
    const decoder = new StringDecoder('utf8')

    child.stdout.on('data', (chunk: Buffer) => {
      try {
        onOutput(decoder.write(chunk))
      } catch (error) {
        child.kill()
        reject(error instanceof AppError ? error : new Error('Invalid login response'))
      }
    })
    child.once('error', () => {
      reject(new Error('Runtime login could not start'))
    })
    child.once('close', (code) => {
      if (code === 0) resolve()
      else
        reject(
          new AppError(
            503,
            'runtime_login_interrupted',
            'The connection to your agent was interrupted before sign-in finished. Please try again.',
          ),
        )
    })
  })
}

/** Only server-owned commands and verified managed placements may call this transport. */
export async function execRuntimeCommand(
  namespace: string,
  deployment: string,
  command: readonly string[],
  onOutput: (chunk: string) => void,
  signal: AbortSignal,
  input?: Buffer,
): Promise<void> {
  if (!existsSync(`${ACCOUNT_DIR}/token`)) {
    if (config.claudeCodeRuntimeProvisioner.kubectl)
      return kubectlLogin(namespace, deployment, command, onOutput, signal, input)
    throw new AppError(
      503,
      'runtime_login_unavailable',
      'Agent sign-in requires the configured Kubernetes connection',
    )
  }
  const token = readFileSync(`${ACCOUNT_DIR}/token`, 'utf8').trim()
  const headers = { Authorization: `Bearer ${token}` }
  const tls = { ca: readFileSync(`${ACCOUNT_DIR}/ca.crt`, 'utf8') }
  const base = `https://kubernetes.default.svc/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`
  const selector = encodeURIComponent(`app=${deployment}`)
  const response = await fetch(`${base}?labelSelector=${selector}`, {
    headers,
    tls,
    signal,
  })

  if (!response.ok) throw new Error('Runtime pod lookup failed')
  const body = (await response.json()) as {
    items?: {
      metadata: { name: string; deletionTimestamp?: string }
      status?: { phase?: string }
    }[]
  }
  const pod = body.items?.find(
    (item) => !item.metadata.deletionTimestamp && item.status?.phase === 'Running',
  )

  if (!pod)
    throw new AppError(409, 'runtime_starting', 'The agent is still starting. Retry in a moment.')
  const url = new URL(`${base}/${encodeURIComponent(pod.metadata.name)}/exec`)

  url.protocol = 'wss:'
  for (const argument of command) url.searchParams.append('command', argument)
  for (const [key, value] of Object.entries({
    container: 'openab',
    stdout: 'true',
    stderr: 'true',
    stdin: input ? 'true' : 'false',
    tty: 'false',
  }))
    url.searchParams.set(key, value)
  await readRuntimeLoginSocket(url, { headers, tls }, onOutput, signal, input)
}

/** Kubernetes exec multiplexes stdout (1), stderr (2), and exit status (3). */
export async function readRuntimeLoginSocket(
  url: URL,
  options: { headers: Record<string, string>; tls?: { ca: string } },
  onOutput: (chunk: string) => void,
  signal: AbortSignal,
  input?: Buffer,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, { ...options, protocols: ['v4.channel.k8s.io'] })

    const decoder = new StringDecoder('utf8')

    ws.binaryType = 'arraybuffer'
    let success = false
    const abort = () => {
      ws.close()
      reject(new Error('Runtime login cancelled'))
    }

    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()

      return
    }
    ws.onopen = () => {
      if (input) {
        for (let offset = 0; offset < input.length; offset += 64 * 1024) {
          ws.send(Buffer.concat([Buffer.from([0]), input.subarray(offset, offset + 64 * 1024)]))
        }
      }
    }
    ws.onmessage = (event) => {
      const data = Buffer.from(event.data as ArrayBuffer)

      try {
        if (data[0] === 1) onOutput(decoder.write(data.subarray(1)))
        if (data[0] === 3) {
          const status = JSON.parse(data.subarray(1).toString()) as { status?: string }

          success = status.status === 'Success'
          ws.close()
        }
      } catch (error) {
        ws.close()
        reject(error instanceof AppError ? error : new Error('Invalid login response'))
      }
    }
    ws.onerror = () => {
      ws.close()
      reject(new Error('Runtime login connection failed'))
    }
    ws.onclose = () => {
      signal.removeEventListener('abort', abort)
      if (success) resolve()
      else reject(new Error('Runtime login stopped'))
    }
  })
}
