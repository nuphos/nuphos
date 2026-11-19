// Real Codex on Windows, signing in the owner's home and an agent's home that links to it
// (#2653). Run with `node --test` and LINK_MODULE naming the
// module to check: main's agent-home (hardLinkFrom) or this branch's owner-file-link
// (linkOwnerFile). EXPECT=shared asserts that a newer login made in the agent reaches the owner
// and nothing older is linked back; EXPECT=refused asserts main's bug: Codex will not save over
// the hard link main makes, so the agent cannot sign in or refresh its token.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

let symlinksAllowed = true

const symlinkSync = fs.symlinkSync

fs.symlinkSync = (...args: Parameters<typeof fs.symlinkSync>) => {
  if (!symlinksAllowed) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
  symlinkSync(...args)
}
// The `import { symlinkSync } from 'node:fs'` in the code under test sees the replacement.
syncBuiltinESMExports()
type Link = (ownerHome: string, home: string, file: string) => void
const linkModule = (await import(
  pathToFileURL(path.resolve(process.env.LINK_MODULE ?? '')).href
)) as {
  linkOwnerFile?: Link
  hardLinkFrom?: Link
}
const link = linkModule.linkOwnerFile ?? linkModule.hardLinkFrom
// The npm-installed codex.cmd, by its full path.
const codex = `"${process.env.CODEX_BIN ?? ''}" -c cli_auth_credentials_store=file`

assert.ok(link, `no link function in ${String(process.env.LINK_MODULE)}`)
const expectShared = process.env.EXPECT === 'shared'

/** `codex login --with-api-key`, which saves auth.json the way a token refresh does. */
function codexLogin(home: string, key: string) {
  execSync(`${codex} login --with-api-key`, {
    env: { ...process.env, CODEX_HOME: home },
    input: key,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
}

/** The last five characters of the key `codex login status` reports for `home`. */
function signedInAs(home: string): string {
  const out = execSync(`${codex} login status 2>&1`, {
    env: { ...process.env, CODEX_HOME: home },
  }).toString()

  return /\*\*\*(\w{5})/.exec(out)?.[1] ?? out.trim()
}

for (const allowed of [true, false]) {
  void test(`symlinks ${allowed ? 'allowed' : 'not allowed'}: a newer login in the agent ${expectShared ? 'reaches the owner' : 'cannot be saved'}`, async () => {
    symlinksAllowed = allowed
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-login-link-'))
    const owner = path.join(dir, 'owner')
    const agent = path.join(dir, 'agent')

    fs.mkdirSync(owner)
    fs.mkdirSync(agent)
    codexLogin(owner, 'sk-owner-login-000000000000OWNER')
    link(owner, agent, 'auth.json')
    assert.equal(signedInAs(agent), 'OWNER')

    // Codex in the agent saves a newer login (as a refresh does), then the agent is prepared again.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    if (!expectShared) {
      assert.throws(() => codexLogin(agent, 'sk-agent-login-000000000000AGENT'))

      return
    }
    codexLogin(agent, 'sk-agent-login-000000000000AGENT')
    link(owner, agent, 'auth.json')
    const [agentNow, ownerNow] = [signedInAs(agent), signedInAs(owner)]

    console.log(`after the agent's login: agent=${agentNow} owner=${ownerNow}`)
    assert.equal(agentNow, 'AGENT')
    assert.equal(ownerNow, 'AGENT', 'the owner’s own Codex has the newer login')

    // The owner's own Codex signs in later: the agent follows, and the older one never returns.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    codexLogin(owner, 'sk-owner-again-00000000000AGAIN')
    link(owner, agent, 'auth.json')
    assert.equal(signedInAs(owner), 'AGAIN')
    assert.equal(signedInAs(agent), 'AGAIN')
    fs.rmSync(dir, { recursive: true, force: true })
  })
}
