#!/usr/bin/env node
// The `claude` fixture-install.sh installs. Both sign-ins show Claude's authorize page and take
// the code pasted back: `setup-token` prints a token, `auth login` saves a credential.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const config = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
const credential = join(config, '.credentials.json')
const signedIn = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) || existsSync(credential)
const authorize = 'https://claude.ai/oauth/authorize?code=true&client_id=e2e&state=e2e'
const afterCode = (done) =>
  createInterface({ input: process.stdin }).once('line', () => {
    done()
    process.exit(0)
  })

if (args.includes('--version')) console.log('2.1.0 (Claude Code)')
else if (args.includes('status'))
  console.log(
    args.includes('--json')
      ? JSON.stringify({ loggedIn: signedIn })
      : signedIn
        ? 'Logged in using Claude account (e2e@example.com)'
        : 'Not logged in',
  )
else if (args.includes('setup-token')) {
  console.log(authorize)
  afterCode(() => console.log(`sk-ant-oat01-${'e2e'.repeat(10)}`))
} else if (args.includes('login')) {
  console.log(`visit: ${authorize}`)
  afterCode(() => {
    mkdirSync(config, { recursive: true })
    writeFileSync(credential, JSON.stringify({ claudeAiOauth: { accessToken: 'e2e' } }))
  })
} else process.exit(1)
