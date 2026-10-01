// Wire-level validators for OpenAB runtime endpoints. Routing itself has no
// gate: the team's selected agent runtime plus registry resolution decide
// where a turn runs.
export type ClaudeCodePreviewConfig = {
  developmentControlKey?: string
  codexDevelopmentControlKey?: string
  tokenEncryptionKey?: string
  codexDevelopmentRuntimeEndpoint?: { url: string; authKey: string }
  /** Development-only endpoint that bypasses the shared runtime registry. */
  developmentRuntimeEndpoint?: {
    url: string
    authKey: string
  }
}

const WEBSOCKET_PROTOCOL_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u

/** The transport key rides in a WebSocket subprotocol token; enforce its charset. */
export function isValidOpenAbTransportKey(value: string): boolean {
  return WEBSOCKET_PROTOCOL_TOKEN.test(value)
}

export function resolveDevelopmentRuntimeEndpoint(
  urlValue?: string,
  authKeyValue?: string,
  prefix = 'CLAUDE_CODE_RUNTIME',
): ClaudeCodePreviewConfig['developmentRuntimeEndpoint'] {
  if (!urlValue && !authKeyValue) return undefined
  if (!urlValue || !authKeyValue) {
    // A lone var is a stray leftover, not an opt-in; it must not abort a
    // CI/staging boot. Both vars present is deliberate, so an invalid value
    // below still fails the boot rather than silently routing to the real
    // team runtime registry.
    console.warn(
      '[claude-code-preview] Ignoring the development runtime override: ' +
        `${prefix}_DEV_URL and ${prefix}_DEV_AUTH_KEY must be set together.`,
    )

    return undefined
  }
  if (!isValidOpenAbTransportKey(authKeyValue)) {
    throw new Error(`${prefix}_DEV_AUTH_KEY is not a valid WebSocket protocol token.`)
  }

  try {
    const url = new URL(urlValue)
    const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    const isWebSocket = url.protocol === 'ws:' || url.protocol === 'wss:'

    if (
      !isLoopback ||
      !isWebSocket ||
      url.username ||
      url.password ||
      url.pathname !== '/acp' ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid local ACP endpoint')
    }
  } catch {
    throw new Error(`${prefix}_DEV_URL must be a loopback WebSocket URL ending in /acp.`)
  }

  return { url: urlValue, authKey: authKeyValue }
}
