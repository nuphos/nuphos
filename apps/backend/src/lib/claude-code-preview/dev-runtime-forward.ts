// Dev-only reachability shim: registry runtimes are cluster-internal
// (`*.svc`) URLs the in-cluster backend dials directly. A backend running
// from a laptop in kubectl mode instead opens one lazy `kubectl port-forward`
// per runtime at socket-open time. Everything else (registry, session
// pinning, durable attachments) keeps the canonical URL.
import { spawn } from 'node:child_process'

import { config } from '@/config'
import { logEvent } from '@/lib/observability'

import { kubectlArgs } from './kubectl-command'

import type { TeamRuntimeEndpoint } from './team-openab-runtime'

type Forward = { port: number; child: ReturnType<typeof spawn> }

const forwards = new Map<string, Promise<Forward>>()
const RUNTIME_READY_TIMEOUT_SECONDS = 90

function clusterService(url: string): { name: string; namespace: string; port: string } | null {
  try {
    const parsed = new URL(url)
    const match = /^([^.]+)\.([^.]+)\.svc(?:\.cluster\.local)?$/u.exec(parsed.hostname)

    if (!match?.[1] || !match[2]) return null

    return { name: match[1], namespace: match[2], port: parsed.port || '8080' }
  } catch {
    return null
  }
}

function openForward(service: { name: string; namespace: string; port: string }): Promise<Forward> {
  return new Promise((resolve, reject) => {
    const args = kubectlArgs([
      '-n',
      service.namespace,
      'port-forward',
      '--address',
      '127.0.0.1',
      `service/${service.name}`,
      `:${service.port}`,
    ])
    const child = spawn(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- dev-only shim, config-gated off in production; kubectl resolves from the operator's own PATH
      'kubectl',
      args,
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let settled = false
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      const match = /Forwarding from 127\.0\.0\.1:(\d+)/u.exec(chunk.toString())

      if (match?.[1] && !settled) {
        settled = true
        resolve({ port: Number(match[1]), child })
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('exit', () => {
      if (!settled) {
        settled = true
        reject(new Error(`kubectl port-forward exited: ${stderr.trim().slice(0, 200)}`))
      }
    })
    setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        reject(new Error('kubectl port-forward timed out'))
      }
    }, 15_000).unref()
  })
}

function waitForRuntime(service: { name: string; namespace: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- dev-only shim; kubectl resolves from the operator's PATH
      'kubectl',
      kubectlArgs([
        '-n',
        service.namespace,
        'wait',
        '--for=condition=Available',
        `deployment/${service.name}`,
        `--timeout=${String(RUNTIME_READY_TIMEOUT_SECONDS)}s`,
      ]),
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        const detail = stderr.trim().slice(0, 200) || `kubectl exited ${String(code)}`

        reject(new Error(`Claude Code runtime did not become ready: ${detail}`))
      }
    })
  })
}

/**
 * The endpoint to actually dial. Identity outside kubectl dev mode or for
 * non-cluster URLs; otherwise a loopback forward to the runtime's Service.
 */
export async function reachableRuntimeEndpoint(
  endpoint: TeamRuntimeEndpoint,
): Promise<TeamRuntimeEndpoint> {
  const provisioner = config.claudeCodeRuntimeProvisioner

  if (!provisioner.kubectl) return endpoint
  const service = clusterService(endpoint.url)

  if (!service) return endpoint

  let pending = forwards.get(endpoint.url)

  if (!pending) {
    // A provisioner rollout uses Recreate, so the Service briefly has no
    // endpoints. Waiting on Deployment availability turns that expected init
    // window into request latency instead of a permanent stream failure.
    const opening = waitForRuntime(service)
      .then(() => openForward(service))
      .then((forward) => {
        logEvent('info', 'claude_code.dev_forward.opened', {
          service: `${service.namespace}/${service.name}`,
          port: forward.port,
        })
        // A dead forward (pod replaced) is forgotten so the next dial re-opens it.
        forward.child.on('exit', () => {
          if (forwards.get(endpoint.url) === opening) forwards.delete(endpoint.url)
        })

        return forward
      })

    opening.catch(() => {
      if (forwards.get(endpoint.url) === opening) forwards.delete(endpoint.url)
    })
    forwards.set(endpoint.url, opening)
    pending = opening
  }
  const { port } = await pending
  const url = new URL(endpoint.url)

  url.hostname = '127.0.0.1'
  url.port = String(port)

  return { ...endpoint, url: url.toString() }
}
