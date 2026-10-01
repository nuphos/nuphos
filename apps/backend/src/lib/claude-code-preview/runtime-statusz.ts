// The sandbox's own /statusz: process-level facts only the pod knows, which
// makes it the same answer from every backend replica.
export type RuntimeStatusz = {
  runtimeVersion?: string
  uptimeSeconds?: number
  agentProcesses?: number
  acpConnections?: number
}

export function statuszUrl(openabUrl: string): string | null {
  try {
    const url = new URL(openabUrl)

    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = '/statusz'

    return url.toString()
  } catch {
    return null
  }
}

/** Null when the runtime is unreachable or answers with anything but 2xx. */
export async function fetchStatusz(
  openabUrl: string,
  timeoutMs = 3_000,
): Promise<{ latencyMs: number; statusz: RuntimeStatusz } | null> {
  const url = statuszUrl(openabUrl)

  if (!url) return null
  const startedAt = Date.now()

  try {
    const [response, runtimeVersion] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }),
      fetchRuntimeVersion(url, timeoutMs),
    ])

    if (!response.ok) return null
    const body = (await response.json().catch(() => null)) as {
      uptime_seconds?: number
      agent_processes?: number
      acp_connections?: number
    } | null

    return {
      latencyMs: Date.now() - startedAt,
      statusz: {
        ...(runtimeVersion ? { runtimeVersion } : {}),
        ...(typeof body?.uptime_seconds === 'number' ? { uptimeSeconds: body.uptime_seconds } : {}),
        ...(typeof body?.agent_processes === 'number'
          ? { agentProcesses: body.agent_processes }
          : {}),
        ...(typeof body?.acp_connections === 'number'
          ? { acpConnections: body.acp_connections }
          : {}),
      },
    }
  } catch {
    return null
  }
}

/** Managed agents disable the console API but still expose their build on the status page. */
async function fetchRuntimeVersion(
  statusUrl: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const url = new URL(statusUrl)
  const signal = AbortSignal.timeout(timeoutMs)

  try {
    url.pathname = '/_openab/console/state'
    const consoleResponse = await fetch(url, { signal, redirect: 'error' })

    if (consoleResponse.ok) {
      const body = (await consoleResponse.json()) as { version?: unknown }

      if (typeof body.version === 'string' && /^\d+\.\d+\.\d+$/.test(body.version))
        return body.version
    }
    url.pathname = '/'
    const response = await fetch(url, { signal, redirect: 'error' })

    if (!response.ok) return undefined
    const html = await response.text()

    return /<dt>Version<\/dt>\s*<dd>(\d+\.\d+\.\d+)<\/dd>/.exec(html)?.[1]
  } catch {
    return undefined
  }
}
