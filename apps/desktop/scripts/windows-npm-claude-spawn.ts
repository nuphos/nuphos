// Spawns the Claude Code that findAgentCli picks the way the Agent SDK spawns it, without a shell.
// Usage: node windows-npm-claude-spawn.ts <agent-cli-find module> <exe|einval>
import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [modulePath, expected] = process.argv.slice(2)
const { findAgentCli } = (await import(pathToFileURL(path.resolve(modulePath!)).href)) as {
  findAgentCli: (provider: 'claude-code', env: NodeJS.ProcessEnv) => string | null
}
const cli = findAgentCli('claude-code', process.env)

console.log(`findAgentCli: ${cli}`)
if (!cli) throw new Error('no Claude Code found')

// The SDK's spawnLocalProcess: piped stdio, hidden window, no shell.
const result = await new Promise<{ code: number | null; error?: string; stdout: string }>(
  (resolve) => {
    let stdout = ''
    const child = spawn(cli, ['--version'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    })

    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.once('error', (error: NodeJS.ErrnoException) =>
      resolve({ code: null, error: error.code, stdout }),
    )
    child.once('exit', (code) => resolve({ code, stdout }))
  },
)

console.log(`spawn: ${JSON.stringify(result)}`)
const ok =
  expected === 'einval'
    ? cli.toLowerCase().endsWith('.cmd') && result.error === 'EINVAL'
    : cli.toLowerCase().endsWith('claude.exe') &&
      result.code === 0 &&
      /Claude Code/u.test(result.stdout)

if (!ok) throw new Error(`expected ${expected}`)
console.log(`as expected: ${expected}`)
