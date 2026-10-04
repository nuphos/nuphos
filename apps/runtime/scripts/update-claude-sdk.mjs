import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function upgradeVersion(current, latest) {
  const parse = (value) => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Expected stable version: ${value}`)
    return value.split('.').map(Number)
  }
  const before = parse(current),
    after = parse(latest)
  if (after[0] !== before[0]) throw new Error('SDK major changes require manual review')
  for (let i = 0; i < 3; i++) {
    if (after[i] !== before[i]) return after[i] > before[i]
  }
  return false
}

function main() {
  const file = 'image/claude-agent-acp/package.json'
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  const current = pkg.overrides['@anthropic-ai/claude-agent-sdk']
  const latest = JSON.parse(
    execFileSync('npm', ['view', '@anthropic-ai/claude-agent-sdk', 'dist-tags.latest', '--json'], {
      encoding: 'utf8',
    }),
  )
  const changed = upgradeVersion(current, latest)
  if (changed) {
    pkg.overrides['@anthropic-ai/claude-agent-sdk'] = latest
    writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
    execFileSync(
      'npm',
      ['install', '--package-lock-only', '--ignore-scripts', '--prefix', 'image/claude-agent-acp'],
      { stdio: 'inherit' },
    )
    const dockerfile = 'image/Dockerfile'
    const source = readFileSync(dockerfile, 'utf8')
    const anchor = `ARG CLAUDE_AGENT_SDK_VERSION=${current}`
    if (source.split(anchor).length !== 2)
      throw new Error('Expected exactly one SDK version assertion')
    writeFileSync(dockerfile, source.replace(anchor, `ARG CLAUDE_AGENT_SDK_VERSION=${latest}`))
    const readme = readFileSync('README.md', 'utf8')
    writeFileSync('README.md', readme.replace(`Agent SDK ${current}`, `Agent SDK ${latest}`))
  }
  const summary = `Claude SDK ${current} → ${latest}; changed=${changed}\n`
  console.log(summary)
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nsdk=${latest}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
