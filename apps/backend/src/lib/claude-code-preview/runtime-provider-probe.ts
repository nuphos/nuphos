// Detects which agent a not-yet-registered self-hosted runtime is running,
// so the connect form does not have to ask. `initialize` already carries the
// adapter's own build stamp (`runtimeBuildInfo`), shaped
// `<adapter-binary>@<version>` — `claude-agent-acp@0.74.0` or
// `codex-acp@0.153.4`. Older runtimes that predate the stamp report nothing,
// so callers must still offer a manual fallback.
import { OpenAbAcpClient } from './openab-acp-client'
import { runtimeBuildInfo } from './openab-acp-session'

import type { SocketFactory } from './openab-acp-session'
import type { OpenAbProvider } from './runtime-provider'

const PROBE_CONNECT_TIMEOUT_MS = 5_000
const PROBE_CALL_TIMEOUT_MS = 5_000

export async function probeExternalRuntimeProvider(
  url: string,
  authKey: string,
  socketFactory?: SocketFactory,
): Promise<OpenAbProvider | undefined> {
  let client: OpenAbAcpClient | undefined

  try {
    client = await OpenAbAcpClient.connect({
      url,
      authKey,
      connectTimeoutMs: PROBE_CONNECT_TIMEOUT_MS,
      callTimeoutMs: PROBE_CALL_TIMEOUT_MS,
      ...(socketFactory ? { socketFactory } : {}),
    })
    const { adapterVersion } = runtimeBuildInfo(await client.initialize())

    if (adapterVersion?.startsWith('codex-acp')) return 'codex'
    if (adapterVersion?.startsWith('claude-agent-acp')) return 'claude-code'
    if (adapterVersion?.startsWith('grok@')) return 'grok'
    if (adapterVersion?.startsWith('antigravity-acp@')) return 'antigravity'

    return undefined
  } catch {
    return undefined
  } finally {
    client?.close()
  }
}
