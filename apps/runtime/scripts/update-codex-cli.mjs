import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { upgradeVersion } from './update-claude-sdk.mjs'

const file = 'image/codex-acp/package.json'
const pkg = JSON.parse(readFileSync(file, 'utf8'))
const current = pkg.dependencies['@openai/codex']
const latest = JSON.parse(
  execFileSync('npm', ['view', '@openai/codex', 'dist-tags.latest', '--json'], {
    encoding: 'utf8',
  }),
)
const changed = upgradeVersion(current, latest)
if (changed) {
  pkg.dependencies['@openai/codex'] = latest
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
  execFileSync(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--prefix', 'image/codex-acp'],
    { stdio: 'inherit' },
  )
  const readme = readFileSync('README.md', 'utf8')
  writeFileSync('README.md', readme.replace(`Codex CLI ${current}`, `Codex CLI ${latest}`))
}
const summary = `Codex CLI ${current} → ${latest}; changed=${changed}\n`
console.log(summary)
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\ncli=${latest}\n`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
