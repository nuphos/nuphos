import { execFileSync } from 'node:child_process'

const [tag, provider] = process.argv.slice(2)
if (!/^runtime-v\d+\.\d+\.\d+$/.test(tag) || !['claude', 'codex', 'both'].includes(provider))
  throw new Error('Usage: runtime-release-notes.mjs runtime-vX.Y.Z claude|codex|both')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const read = (file) => JSON.parse(git('show', `${tag}:apps/runtime/${file}`))
const runtime = read('package.json')
if (tag !== `runtime-v${runtime.version}`)
  throw new Error('Tag and packaged runtime version differ')
const claude = read('image/claude-agent-acp/package.json')
const codex = read('image/codex-acp/package.json')
let previous
try {
  previous = git('describe', '--tags', '--abbrev=0', '--match', 'runtime-v[0-9]*', `${tag}^`)
} catch {}
const repo = 'https://github.com/nuphos/nuphos'
const range = previous ? `${previous}..${tag}` : tag
const commits = git(
  'log',
  '--format=%h%x09%s',
  range,
  '--',
  ':(top)apps/runtime',
  ':(top).github/workflows/runtime-*.yml',
  ':(top).gitmodules',
)
  .split('\n')
  .filter(Boolean)
const lines = [
  '## Changes',
  '',
  ...commits.map((line) => {
    const [sha, ...subject] = line.split('\t')
    return `- ${subject.join('\t')} ([${sha}](${repo}/commit/${sha}))`
  }),
  '',
  '## Included versions',
  '',
  '| Component | Version |',
  '| --- | --- |',
]
if (provider !== 'codex')
  lines.push(
    `| Claude Agent SDK | ${claude.overrides['@anthropic-ai/claude-agent-sdk']} |`,
    `| Claude ACP adapter | ${claude.dependencies['@agentclientprotocol/claude-agent-acp']} |`,
  )
if (provider !== 'claude')
  lines.push(
    `| Codex CLI | ${codex.dependencies['@openai/codex']} |`,
    `| Codex ACP adapter | ${codex.dependencies['@agentclientprotocol/codex-acp']} |`,
  )
lines.push('', '## Container images', '')
for (const name of provider === 'both'
  ? ['claude-code', 'codex']
  : [provider === 'claude' ? 'claude-code' : 'codex'])
  lines.push(`- \`ghcr.io/zeabur/nuphos-runtime:${runtime.version}-${name}\``)
lines.push(
  '',
  'Publishing these images does not deploy them to existing runtimes or update the Desktop bundle.',
)
if (previous) lines.push('', `[Full changelog](${repo}/compare/${previous}...${tag})`)
console.log(lines.join('\n'))
