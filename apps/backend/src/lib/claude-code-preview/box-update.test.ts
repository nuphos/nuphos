import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { BOX_INSTALL_COMMAND, BOX_UPDATE_COMMAND } from '@/lib/agent/devices/box-instabox-client'

import { boxUpdateStatus, requestBoxUpdate } from './box-update'

import type { BoxUpdateDeps } from './box-update'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/box-update.test.ts

const claude = localRuntimeId({ userId: 'u1', deviceId: 'box-1', provider: 'claude-code' })
const codex = localRuntimeId({ userId: 'u1', deviceId: 'box-1', provider: 'codex' })
const status = (cliVersion?: string) =>
  ({
    agents: { 'claude-code': {}, codex: {} },
    ...(cliVersion ? { cliVersion } : {}),
  }) as unknown as LocalRuntimeStatus

function deps(overrides: Partial<BoxUpdateDeps> = {}) {
  const calls = { updated: 0, marked: 0, asked: [] as string[] }
  const value: BoxUpdateDeps = {
    isBox: async () => true,
    canManage: async (actorId) => actorId === 'admin',
    status: async () => status('0.4.0'),
    latestVersion: async () => ({ version: '0.5.0', url: 'https://example.test/cli-v0.5.0' }),
    busy: async (_team, id, actorId) => {
      calls.asked.push(`${actorId}:${id}`)

      return false
    },
    update: async () => {
      calls.updated++
    },
    markUpdating: async () => {
      // Noted only once the update command started.
      expect(calls.updated).toBe(1)
      calls.marked++
    },
    ...overrides,
  }

  return { value, calls }
}

describe('Box update', () => {
  test('a Box agent compares the CLI its host reports with the newest CLI release', async () => {
    expect(await boxUpdateStatus(claude, deps().value)).toEqual({
      state: 'available',
      currentVersion: '0.4.0',
      latestVersion: '0.5.0',
      releaseUrl: 'https://example.test/cli-v0.5.0',
    })
    const current = deps({ status: async () => status('0.5.0') }).value

    expect((await boxUpdateStatus(claude, current))?.state).toBe('current')
    // An older host that does not report its CLI cannot be compared.
    const old = deps({ status: async () => status() }).value

    expect((await boxUpdateStatus(claude, old))?.state).toBe('unknown')
    // Not a Box, or a Box that is away: no update to show.
    expect(await boxUpdateStatus(claude, deps({ isBox: async () => false }).value)).toBeUndefined()
    expect(
      await boxUpdateStatus(claude, deps({ status: async () => undefined }).value),
    ).toBeUndefined()
  })

  test('updating restarts the host only when none of its agents is mid-turn', async () => {
    const idle = deps()

    expect(await requestBoxUpdate('t1', codex, 'admin', idle.value)).toEqual({ version: '0.5.0' })
    expect(idle.calls.updated).toBe(1)
    // Every viewer of the Box sees it updating rather than offline.
    expect(idle.calls.marked).toBe(1)
    // Every agent the host runs is asked, as the administrator, not only the one whose card was used.
    expect(idle.calls.asked).toEqual([`admin:${claude}`, `admin:${codex}`])

    const busy = deps({ busy: async (_team, id) => id === codex })

    await expect(requestBoxUpdate('t1', claude, 'admin', busy.value)).rejects.toMatchObject({
      status: 409,
      code: 'runtime_busy',
      message: 'Updates wait for active conversations to finish.',
    })
    expect(busy.calls.updated).toBe(0)
  })

  test('an update that started is reported as started even when noting it fails', async () => {
    const unnoted = deps({
      markUpdating: async () => {
        throw new Error('database is down')
      },
    })

    expect(await requestBoxUpdate('t1', codex, 'admin', unnoted.value)).toEqual({
      version: '0.5.0',
    })
    expect(unnoted.calls.updated).toBe(1)
  })

  test('an update is refused for a personal computer, another team’s Box, an away Box, or no known release', async () => {
    const refused = async (overrides: Partial<BoxUpdateDeps>, actorId = 'admin') => {
      const attempt = deps(overrides)

      await requestBoxUpdate('t1', claude, actorId, attempt.value).catch((error: unknown) => {
        expect(attempt.calls.updated).toBe(0)
        expect(attempt.calls.marked).toBe(0)
        throw error
      })
    }

    await expect(refused({ isBox: async () => false })).rejects.toMatchObject({
      status: 409,
      code: 'runtime_not_managed',
    })
    // Not an administrator of this Box's team (or another team's Box): not found.
    await expect(refused({}, 'someone-else')).rejects.toMatchObject({
      status: 404,
      code: 'device_not_found',
    })
    await expect(refused({ status: async () => undefined })).rejects.toMatchObject({
      code: 'runtime_offline',
    })
    await expect(refused({ latestVersion: async () => null })).rejects.toMatchObject({
      code: 'runtime_release_unavailable',
    })
  })

  test('the update installs the newest CLI, drops generated panels and always restarts the host', () => {
    // One install step for create and update: it always fetches the newest CLI.
    expect(BOX_INSTALL_COMMAND).toContain('curl -fsSL https://nuphos.ai/install | sh')
    expect(BOX_INSTALL_COMMAND).not.toContain('command -v nuphos')
    const lines = BOX_UPDATE_COMMAND.split('\n')

    // The host is stopped first, killed if it hangs, and started last, even when the install fails.
    expect(lines[0]).toContain('pkill -f "[h]ost.mjs"')
    expect(lines[1]).toBe('pkill -9 -f "[h]ost.mjs"')
    expect(lines.at(-1)).toContain('nuphos agent')
    expect(BOX_UPDATE_COMMAND).toContain(`(\n${BOX_INSTALL_COMMAND}`)
    // Only session panels without the browser launcher are dropped.
    expect(BOX_UPDATE_COMMAND).toContain('grep -L web-browser.desktop')
  })

  test('the update empties a written AGENTS.md and keeps its links, never one someone edited', () => {
    const cleanup = BOX_UPDATE_COMMAND.split('\n').find((line) => line.includes('AGENTS.md'))
    const run = (setup: string) => {
      const home = mkdtempSync(path.join(os.tmpdir(), 'box-home-'))

      for (const [name, text] of Object.entries(WRITTEN_AGENTS))
        writeFileSync(path.join(home, `${name}.md`), text)
      execFileSync('/bin/bash', ['-ec', `mkdir -p .claude .codex; ${setup}`], { cwd: home })
      execFileSync('/bin/bash', ['-ec', cleanup ?? 'false'], {
        env: { ...process.env, HOME: home },
      })

      // Each instruction file as a link, its size, or absent.
      return ['AGENTS.md', '.claude/CLAUDE.md', '.codex/AGENTS.md'].map((file) => {
        const full = path.join(home, file)

        if (!existsSync(full)) return `${file}:absent`

        return lstatSync(full).isSymbolicLink()
          ? `${file}:link`
          : `${file}:${String(statSync(full).size)}`
      })
    }
    const links =
      'ln -s "$PWD/AGENTS.md" .claude/CLAUDE.md; ln -s "$PWD/AGENTS.md" .codex/AGENTS.md'
    const emptied = ['AGENTS.md:0', '.claude/CLAUDE.md:link', '.codex/AGENTS.md:link']

    // What the image and what instabox wrote are emptied in place; the links keep pointing at it.
    for (const name of Object.keys(WRITTEN_AGENTS))
      expect(run(`cp ${name}.md AGENTS.md; ${links}`)).toEqual(emptied)
    // Edited in place, links untouched: the team's instructions stay.
    const edited = run(`cp image.md AGENTS.md; echo '- Our rule' >> AGENTS.md; ${links}`)

    expect(edited).toEqual([
      `AGENTS.md:${String(WRITTEN_AGENTS.image.length + '- Our rule\n'.length)}`,
      '.claude/CLAUDE.md:link',
      '.codex/AGENTS.md:link',
    ])
    expect(run('echo mine > AGENTS.md; echo own > .claude/CLAUDE.md')).toEqual([
      'AGENTS.md:5',
      '.claude/CLAUDE.md:4',
      '.codex/AGENTS.md:absent',
    ])
    expect(run(':')).toEqual([
      'AGENTS.md:absent',
      '.claude/CLAUDE.md:absent',
      '.codex/AGENTS.md:absent',
    ])
  })
})

/** Each ~/AGENTS.md that was written for agents, byte for byte (their sha256 are in IMAGE_AGENTS_SHA256). */
const WRITTEN_AGENTS = {
  /** The Nuphos Box image's. */
  image: `# Agent notes

You are running on a Nuphos Box: a Linux VM in the cloud that runs this team's
Nuphos agents. People talk to you through Nuphos; nobody uses this machine's
own console. Work in /data/workspace.

- Anything visual (a web page, a browser, a GUI app): use the desktop tools
  (the \`nuphos-desktop\` MCP server: get_app_state, click, type_text, ...).
  The first call starts this conversation's own desktop, and the person
  watches it live in Nuphos. Do not start X, Xvnc or a browser on DISPLAY=:1
  from the shell; that display is not used for conversations.
- ~/MACHINE.md lists the machine's size, what survives a stop, and the
  installed tools. Ignore its notes about the instabox dashboard, its
  Computer tab and display :1; they do not apply on a Nuphos Box.
`,
  /** What instabox writes wherever ~/AGENTS.md is missing. */
  instabox: `# Agent notes

You are running on an instabox sandbox, a Linux VM in the cloud. Nobody is at
its screen and it has no public address. Read ~/MACHINE.md for its ID, size,
what survives a stop, and the tools installed. Work in /data/workspace.

People watch this machine's desktop on the dashboard's Computer tab. While
it runs, browsers Playwright or Puppeteer launch from a new shell show there
(DISPLAY=:1, headed); INSTABOX_HEADLESS=1 keeps them headless.
`,
}
