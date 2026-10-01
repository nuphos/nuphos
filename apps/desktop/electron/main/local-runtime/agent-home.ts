import { existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { LocalAgentProvider } from './agent-cli.ts'

/**
 * A CODEX_HOME that holds only a link to the user's own login, so Codex
 * serving Nuphos never loads their personal config.toml, MCP servers,
 * connectors or AGENTS.md. A link rather than a copy: Codex refreshes the
 * token in place, and a copy would fork it from the user's own `codex`.
 * Undefined when there is no login to link or the link cannot be made; Codex
 * then does not run as a local agent at all.
 */
export function prepareCodexHome(
  userDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const source = path.join(env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'auth.json')
  const home = path.join(userDir, 'codex-home')
  const link = path.join(home, 'auth.json')

  try {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const existing = lstatSync(link, { throwIfNoEntry: false })

    if (!existing) symlinkSync(source, link)
    else if (!existing.isSymbolicLink()) return undefined

    return existsSync(source) ? home : undefined
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
 * CLAUDE.md. The login stays theirs: `agentEnv` points Claude Code's
 * credential store back at the owner's own.
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
): string | undefined {
  return provider === 'codex' ? prepareCodexHome(userDir) : prepareClaudeHome(userDir, workspace)
}
