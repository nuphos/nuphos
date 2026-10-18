// On a Linux Box the host sets NUPHOS_DESKTOP_SESSION (the wrapper's path) and
// NUPHOS_DESKTOP_POOL; every Claude session then gets a `nuphos-desktop` MCP server
// that serves it on its own desktop. Not `computer-use`: Claude Code reserves that
// name for its own server and silently drops a configured one. The function body is injected into the
// adapter, so it must stand alone (adapter-patches.mjs).
export function nuphosBoxDesktopMcpServers(servers, sessionEnv, env = process.env) {
  const sessionId = sessionEnv?.NUPHOS_SESSION_ID
  const wrapper = env.NUPHOS_DESKTOP_SESSION
  const pool = env.NUPHOS_DESKTOP_POOL

  if (!sessionId || !wrapper || !pool || !Array.isArray(servers)) return servers
  if (servers.some((server) => server?.name === 'nuphos-desktop')) return servers

  return [
    ...servers,
    {
      name: 'nuphos-desktop',
      command: process.execPath,
      args: [wrapper, 'serve'],
      env: [
        { name: 'NUPHOS_SESSION_ID', value: sessionId },
        { name: 'NUPHOS_DESKTOP_POOL', value: pool },
        { name: 'NUPHOS_DESKTOP_POOL_SIZE', value: env.NUPHOS_DESKTOP_POOL_SIZE ?? '' },
        { name: 'HOME', value: nuphosSessionHomeEnv(sessionEnv, env).HOME },
        { name: 'PATH', value: env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
        { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
      ],
    },
  ]
}
