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
export function patchDesktopAdapter(source) {
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
  const shebang = /^#![^\n]*\n/u.exec(patched)?.[0] ?? ''

  return `${shebang}${nuphosLocalSyncSkills.toString()}\n${patched.slice(shebang.length)}`
}
