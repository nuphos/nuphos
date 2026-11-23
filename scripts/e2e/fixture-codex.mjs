#!/usr/bin/env node
// The `codex` the agent reset suite puts on its computer. Like `codex login status`, it reports
// itself signed in while its home holds auth.json; nothing else of Codex is modelled.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const home = process.env.CODEX_HOME ?? join(homedir(), '.codex')

if (args.includes('--version')) console.log('codex-cli 0.130.0')
else if (args[0] === 'login' && args[1] === 'status') {
  if (existsSync(join(home, 'auth.json'))) console.log('Logged in using ChatGPT')
  else {
    console.log('Not logged in')
    process.exit(1)
  }
} else process.exit(1)
