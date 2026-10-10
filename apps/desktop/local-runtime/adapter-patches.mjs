import {
  COMPUTER_USE_PERMISSION_SCRIPT,
  nuphosAuthorizeComputerUse,
} from './computer-use-permission.mjs'
import { nuphosDesktopClaudeEnv } from './claude-session-env.mjs'
import { nuphosLocalSyncSkills } from './skills-sync.mjs'

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
  }
  const shebang = /^#![^\n]*\n/u.exec(patched)?.[0] ?? ''

  const claudeEnv =
    provider === 'claude-code'
      ? `import { constants as nuphosDesktopFs, mkdirSync as nuphosDesktopMkdir, writeFileSync as nuphosDesktopWrite } from 'node:fs';\nimport { join as nuphosDesktopJoin } from 'node:path';\n${nuphosDesktopClaudeEnv.toString()}\n`
      : ''

  const computerUse =
    provider === 'codex'
      ? `const COMPUTER_USE_PERMISSION_SCRIPT = ${JSON.stringify(COMPUTER_USE_PERMISSION_SCRIPT)};\n${nuphosAuthorizeComputerUse.toString()}\n`
      : ''

  return `${shebang}${computerUse}${claudeEnv}${nuphosLocalSyncSkills.toString()}\n${patched.slice(shebang.length)}`
}
