import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { LocalAgentProvider } from './agent-cli.ts'

const CUA_PLUGIN = 'unified-computer-use@openai-bundled'
const CUA_PLUGIN_CACHE = path.join('plugins', 'cache', 'openai-bundled', 'unified-computer-use')

/** False when something other than a link already sits at `file`. */
function linkFrom(ownerHome: string, home: string, file: string): boolean {
  const link = path.join(home, file)
  const existing = lstatSync(link, { throwIfNoEntry: false })

  if (existing) return existing.isSymbolicLink()
  mkdirSync(path.dirname(link), { recursive: true })
  symlinkSync(path.join(ownerHome, file), link, 'junction')

  return true
}

/**
 * A CODEX_HOME that holds only links to the user's own login and the Codex
 * App's Computer Use plugin, so Codex serving Nuphos never loads their
 * personal config.toml, MCP servers, connectors or AGENTS.md. Links rather
 * than copies: Codex refreshes the token in place, and the App updates the
 * plugin in place. Loading the plugin itself, not just its MCP server, brings
 * the App's turn-end hook that puts away the Computer Use cursor.
 * Undefined when there is no login to link or the link cannot be made; Codex
 * then does not run as a local agent at all.
 */
export function prepareCodexHome(
  userDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const ownerHome = env.CODEX_HOME ?? path.join(env.HOME ?? os.homedir(), '.codex')
  const home = path.join(userDir, 'codex-home')
  const config = path.join(home, 'config.toml')

  try {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    if (!linkFrom(ownerHome, home, 'auth.json')) return undefined
    // Codex skips an enabled plugin that is not installed, so users without the App are unaffected.
    if (
      linkFrom(ownerHome, home, CUA_PLUGIN_CACHE) &&
      !(existsSync(config) && readFileSync(config, 'utf8').includes(CUA_PLUGIN))
    )
      appendFileSync(config, `\n[plugins."${CUA_PLUGIN}"]\nenabled = true\n`, { mode: 0o600 })

    return existsSync(path.join(ownerHome, 'auth.json')) ? home : undefined
  } catch {
    return undefined
  }
}

function ancestorsOf(dir: string): string[] {
  const ancestors: string[] = []

  for (let parent = path.dirname(dir); ; parent = path.dirname(parent)) {
    ancestors.push(parent)
    if (path.dirname(parent) === parent) return ancestors
  }
}

/**
 * The user settings Claude Code reads from its isolated CLAUDE_CONFIG_DIR. The
 * workspace sits under the owner's home, so Claude Code's walk up from it would
 * otherwise still find ~/.claude/CLAUDE.md and ~/CLAUDE.md.
 */
export function claudeHomeSettings(workspace: string): Record<string, unknown> {
  return {
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    claudeMdExcludes: ancestorsOf(path.resolve(workspace)).flatMap((dir) =>
      ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md', '.claude/rules/**'].map((file) =>
        path.join(dir, file).replaceAll('\\', '/'),
      ),
    ),
  }
}

/**
 * A CLAUDE_CONFIG_DIR of Nuphos's own, so Claude Code serving Nuphos never
 * loads the owner's settings, hooks, plugins, skills, MCP servers or
 * CLAUDE.md. Claude signs in separately here; session HOME changes and the
 * owner's terminal do not select or overwrite this credential store.
 */
export function prepareClaudeHome(userDir: string, workspace: string): string | undefined {
  const home = path.join(userDir, 'claude-home')

  try {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    writeFileSync(
      path.join(home, 'settings.json'),
      `${JSON.stringify(claudeHomeSettings(workspace), null, 2)}\n`,
      { mode: 0o600 },
    )

    return home
  } catch {
    return undefined
  }
}

export function prepareAgentHome(
  provider: LocalAgentProvider,
  userDir: string,
  workspace: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return provider === 'codex'
    ? prepareCodexHome(userDir, env)
    : prepareClaudeHome(userDir, workspace)
}
