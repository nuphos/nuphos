// MCP clients fix HTTP headers when they connect, so a bearer-only Nuphos MCP
// server is run through the stdio bridge, which reads the current token from
// OPENAB_CREDENTIALS_DIR on every request. Input and output are ACP shapes.
// Only these two rotate a Nuphos bearer. A team's own server keeps the headers it was
// given — including a single Bearer — and the agent dials that URL itself. The backend
// checked OUTBOUND_* before handing the URL over; this process does not.
const NUPHOS_MCP_SERVERS = new Set(['nuphos-credentials', 'nuphos-tools'])

export function nuphosBridgeMcpServers(servers, env = process.env, execPath = process.execPath) {
  const dir = env.OPENAB_CREDENTIALS_DIR
  if (!dir || !Array.isArray(servers)) return servers
  return servers.map((server) => {
    if (!NUPHOS_MCP_SERVERS.has(server?.name)) return server
    const headers = server?.type === 'http' && Array.isArray(server.headers) ? server.headers : []
    const [header] = headers
    const authorization =
      headers.length === 1 && header.name.toLowerCase() === 'authorization' ? header.value : ''
    if (!authorization.startsWith('Bearer ')) return server
    return {
      name: server.name,
      command: execPath,
      args: ['/opt/nuphos-runtime/mcp-http-bridge.mjs', server.url],
      env: [{ name: 'OPENAB_CREDENTIALS_DIR', value: dir }],
    }
  })
}
