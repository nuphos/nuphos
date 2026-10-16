import { nuphosBoxDesktopMcpServers } from './box-desktop-mcp.mjs'
import { nuphosAuthorizeComputerUse } from './computer-use-permission.mjs'
import { nuphosDesktopClaudeEnv } from './claude-session-env.mjs'
import { nuphosLocalSyncSkills } from './skills-sync.mjs'

const CODEX_HANDOFF = /nuphosBridgeMcpServers\(request\.mcpServers( \?\? \[\])?\)/gu

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2)
    throw new Error(`Desktop adapter patch anchor moved: ${anchor.slice(0, 80)}`)

  return source.replace(anchor, () => replacement)
}

/**
 * Runs after nuphos-runtime's own patch. The image keeps its MCP bridge and
 * skills sync at fixed Linux paths; on a desktop both live beside the adapter,
 * and the bridge runs on Electron's own Node.
 */
export function patchDesktopAdapter(source, provider) {
  let patched = replaceOnce(
    source,
    "args: ['/opt/nuphos-runtime/mcp-http-bridge.mjs', server.url],",
    "args: [env.NUPHOS_MCP_BRIDGE ?? '/opt/nuphos-runtime/mcp-http-bridge.mjs', server.url],",
  )

  patched = replaceOnce(
    patched,
    "env: [{ name: 'OPENAB_CREDENTIALS_DIR', value: dir }],",
    "env: [{ name: 'OPENAB_CREDENTIALS_DIR', value: dir }, { name: 'ELECTRON_RUN_AS_NODE', value: '1' }],",
  )
  if (!patched.includes('await nuphosSyncRuntimeSkills(params);'))
    throw new Error('Desktop adapter patch anchor moved: skills sync')
  patched = patched.replaceAll(
    'await nuphosSyncRuntimeSkills(params);',
    'await nuphosLocalSyncSkills(params);',
  )
  if (provider === 'claude-code') {
    // A Linux Box gives every session a `computer-use` server on its own desktop.
    patched = replaceOnce(
      patched,
      'for (const server of nuphosBridgeMcpServers(params.mcpServers)) {',
      'for (const server of nuphosBoxDesktopMcpServers(nuphosBridgeMcpServers(params.mcpServers), params._meta?.claudeCode?.options?.env, process.env)) {',
    )
    patched = replaceOnce(
      patched,
      'const isolated = nuphosSessionHomeEnv(sessionEnv, runtimeEnv)',
      'const isolated = nuphosDesktopClaudeEnv(nuphosSessionHomeEnv(sessionEnv, runtimeEnv), runtimeEnv)',
    )
    patched = replaceOnce(
      patched,
      '...nuphosSessionHomeEnv(userProvidedOptions?.env),',
      '...nuphosDesktopClaudeEnv(nuphosSessionHomeEnv(userProvidedOptions?.env)),',
    )
  }
  if (provider === 'codex') {
    patched = replaceOnce(
      patched,
      'async handleElicitation(params) {\n    try {',
      'async handleElicitation(params) {\n    try {\n      await nuphosAuthorizeComputerUse(params, this.cancellationSignal);',
    )
    // The same per-session desktop as Claude's, at each of Codex's three session handoffs.
    const handoffs = patched.match(CODEX_HANDOFF)?.length ?? 0

    if (handoffs !== 3) throw new Error('Desktop adapter patch anchor moved: Codex MCP servers')
    patched = patched.replace(
      CODEX_HANDOFF,
      (_, fallback = '') =>
        `nuphosBoxDesktopMcpServers(nuphosBridgeMcpServers(request.mcpServers${fallback}), request._meta?.['ai.nuphos/codex']?.env, process.env)`,
    )
  }
  const shebang = /^#![^\n]*\n/u.exec(patched)?.[0] ?? ''

  const claudeEnv =
    provider === 'claude-code'
      ? `import { constants as nuphosDesktopFs, mkdirSync as nuphosDesktopMkdir, writeFileSync as nuphosDesktopWrite } from 'node:fs';\nimport { join as nuphosDesktopJoin } from 'node:path';\n${nuphosDesktopClaudeEnv.toString()}\n${nuphosBoxDesktopMcpServers.toString()}\n`
      : ''

  const computerUse =
    provider === 'codex'
      ? `${nuphosAuthorizeComputerUse.toString()}\n${nuphosBoxDesktopMcpServers.toString()}\n`
      : ''

  return `${shebang}${computerUse}${claudeEnv}${nuphosLocalSyncSkills.toString()}\n${patched.slice(shebang.length)}`
}
