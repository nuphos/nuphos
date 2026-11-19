import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// Most Windows computers may not create a file symlink (no Developer Mode); the hard link stays.
let symlinksAllowed = true

const symlinkSync = fs.symlinkSync

fs.symlinkSync = (...args: Parameters<typeof fs.symlinkSync>) => {
  if (!symlinksAllowed) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
  symlinkSync(...args)
}
// The `import { symlinkSync } from 'node:fs'` in the code under test sees the replacement.
syncBuiltinESMExports()
const { linkOwnerFile } = await import('./owner-file-link.ts')

function homes(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-login-'))
  const owner = path.join(dir, 'owner')
  const home = path.join(dir, 'codex-home')

  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(owner)
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(owner, 'auth.json'), '{"tokens":"first"}')

  return { owner: path.join(owner, 'auth.json'), agent: path.join(home, 'auth.json'), home }
}

/** How Codex saves auth.json: a new file renamed over the old one, which breaks a hard link. */
function codexSaves(file: string, contents: string, secondsAgo = 0) {
  fs.writeFileSync(`${file}.new`, contents)
  fs.renameSync(`${file}.new`, file)
  const at = new Date(Date.now() - secondsAgo * 1000)

  fs.utimesSync(file, at, at)
}

for (const allowed of [true, false]) {
  test(`a refresh made in the agent reaches the owner, and an older login never comes back (symlinks ${allowed ? 'allowed' : 'not allowed'})`, (t) => {
    symlinksAllowed = allowed
    const f = homes(t)

    linkOwnerFile(path.dirname(f.owner), f.home, 'auth.json')
    // The agent refreshes its token: Codex writes it where auth.json resolves.
    codexSaves(fs.realpathSync(f.agent), '{"tokens":"refreshed"}')
    linkOwnerFile(path.dirname(f.owner), f.home, 'auth.json')
    assert.equal(fs.readFileSync(f.owner, 'utf8'), '{"tokens":"refreshed"}')
    assert.equal(fs.readFileSync(f.agent, 'utf8'), '{"tokens":"refreshed"}')

    // The owner's own Codex signs in later; its newer file wins over an older one here.
    if (fs.lstatSync(f.agent).isFile()) codexSaves(f.agent, '{"tokens":"older"}', 60)
    codexSaves(f.owner, '{"tokens":"owner"}')
    linkOwnerFile(path.dirname(f.owner), f.home, 'auth.json')
    assert.equal(fs.readFileSync(f.owner, 'utf8'), '{"tokens":"owner"}')
    assert.equal(fs.readFileSync(f.agent, 'utf8'), '{"tokens":"owner"}')
  })
}
