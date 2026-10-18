import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { previewSessionPrincipalChanged } from './agent-chat-runtime'
import { previewSessionAccess } from './credentials-mcp'
import { personalCredentialSubject } from './mcp-token'

// The runtime image derives each turn's HOME from this env. Imported by path:
// it ships with the runtime, not the backend.
const SESSION_HOME = join(import.meta.dir, '../../../../runtime/image/session-home.mjs')
const { nuphosSessionHomeEnv } = (await import(SESSION_HOME)) as {
  nuphosSessionHomeEnv: (
    sessionEnv: Record<string, string>,
    runtimeEnv: Record<string, string>,
  ) => Record<string, string>
}

const runtimeHome = mkdtempSync(join(tmpdir(), 'nuphos-home-'))

afterAll(() => rmSync(runtimeHome, { recursive: true, force: true }))

/** One turn in conv-1 (owned by `owner`): who it acts as, and where its CLI logins live. */
function turn(actor: string, humanTurn: boolean) {
  const access = previewSessionAccess('conv-1', 'team-1', actor, 'owner', {
    backendUrl: 'https://backend.example',
    humanTurn,
  })
  const env = access.runtimeEnv ?? {}
  const home = nuphosSessionHomeEnv(env, { HOME: runtimeHome, PATH: '' })
  const authorization = access.mcpServers[0]?.headers[0]?.value

  return {
    actor,
    runtime: { env },
    subject: personalCredentialSubject(authorization),
    // Where the github and linear skills' setup scripts leave their logins.
    githubLogin: join(home.GH_CONFIG_DIR ?? '', 'hosts.yml'),
    linearLogin: join(home.HOME ?? '', '.linear', 'nuphos.env'),
  }
}

function login(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'personal')
}

const changed = (from: ReturnType<typeof turn>, to: ReturnType<typeof turn>) =>
  previewSessionPrincipalChanged({ userId: from.actor, ...from }, to.actor, to.runtime)

describe('Personal Credential identity across a session’s turns', () => {
  test('owner turn -> automated turn -> owner turn act as the owner, in the owner’s HOME', () => {
    const human = turn('owner', true)
    const trigger = turn('owner', false)
    // An agent-thread message is sent by another session's principal.
    const thread = turn('someone-else', false)

    login(human.githubLogin)
    login(human.linearLogin)

    for (const automated of [trigger, thread]) {
      expect(automated.subject).toBe('owner')
      expect(automated.githubLogin).toBe(human.githubLogin)
      expect(automated.linearLogin).toBe(human.linearLogin)
    }
    expect(changed(human, trigger)).toBe(false)
    expect(turn('owner', true).subject).toBe('owner')
  })

  test('a teammate’s turn acts as the teammate and never sees the owner’s logins', () => {
    const owner = turn('owner', true)
    const teammate = turn('teammate', true)

    login(owner.githubLogin)
    login(owner.linearLogin)

    expect(teammate.subject).toBe('teammate')
    expect(existsSync(teammate.githubLogin)).toBe(false)
    expect(existsSync(teammate.linearLogin)).toBe(false)
    // Each switch reloads the session; the runtime recreates it in the new HOME (#504).
    expect(changed(owner, teammate)).toBe(true)
    expect(changed(teammate, owner)).toBe(true)
    expect(changed(teammate, turn('owner', false))).toBe(true)
  })
})
