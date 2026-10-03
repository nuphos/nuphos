import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Add only the installed App-managed CUA server, never the owner's other MCPs. */
export function nuphosLocalCodexMcpServers(config, env = process.env) {
  const servers = config.mcp_servers ?? {}
  const ownerHome = env.NUPHOS_CODEX_USER_HOME

  if (!ownerHome || servers.cua_repl) return servers
  const root = join(ownerHome, 'plugins', 'cache', 'openai-bundled', 'unified-computer-use')
  let versions

  try {
    versions = readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  } catch {
    return servers
  }
  for (const version of versions) {
    try {
      const manifest = JSON.parse(readFileSync(join(root, version, '.mcp.json'), 'utf8'))
      const server = manifest.mcpServers?.cua_repl

      if (server?.enabled === false) return servers
      if (
        !server ||
        typeof server.command !== 'string' ||
        !existsSync(server.command) ||
        !Array.isArray(server.args) ||
        server.args.some((arg) => typeof arg !== 'string') ||
        !server.args.length ||
        !existsSync(server.args[0])
      )
        continue

      return {
        ...servers,
        cua_repl: {
          ...server,
          env: {
            ...server.env,
            // Shell HOME is conversation-scoped; the native service belongs to the OS user.
            ...(process.platform === 'darwin'
              ? {
                  SKY_CUA_SERVICE_NATIVE_PIPE_PATH:
                    server.env?.SKY_CUA_SERVICE_NATIVE_PIPE_PATH ??
                    join(
                      env.HOME ?? homedir(),
                      'Library',
                      'Group Containers',
                      '2DC432GLL2.com.openai.sky.CUAService',
                      'IPC',
                      'computeruse.sock',
                    ),
                }
              : {}),
          },
        },
      }
    } catch {
      // An App update may leave an incomplete cache version; keep looking.
    }
  }

  return servers
}
