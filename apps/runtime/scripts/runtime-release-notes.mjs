import { execFileSync } from 'node:child_process'

const PROVIDERS = ['claude', 'codex', 'grok', 'antigravity', 'opencode']
const [tag, provider] = process.argv.slice(2)
if (!/^runtime-v\d+\.\d+\.\d+$/.test(tag) || ![...PROVIDERS, 'all'].includes(provider))
  throw new Error(
    `Usage: runtime-release-notes.mjs runtime-vX.Y.Z ${[...PROVIDERS, 'all'].join('|')}`,
  )
const includes = (name) => provider === 'all' || provider === name
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const read = (file) => JSON.parse(git('show', `${tag}:apps/runtime/${file}`))
const runtime = read('package.json')
if (tag !== `runtime-v${runtime.version}`)
  throw new Error('Tag and packaged runtime version differ')
const claude = read('image/claude-agent-acp/package.json')
const codex = read('image/codex-acp/package.json')
const { tools } = read('image/tools/manifest.json')
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
if (includes('claude'))
  lines.push(
    `| Claude Agent SDK | ${claude.overrides['@anthropic-ai/claude-agent-sdk']} |`,
    `| Claude ACP adapter | ${claude.dependencies['@agentclientprotocol/claude-agent-acp']} |`,
  )
if (includes('codex'))
  lines.push(
    `| Codex CLI | ${codex.dependencies['@openai/codex']} |`,
    `| Codex ACP adapter | ${codex.dependencies['@agentclientprotocol/codex-acp']} |`,
  )
if (includes('grok')) lines.push(`| Grok Build CLI | ${tools.grok.version} |`)
if (includes('antigravity'))
  lines.push(`| Antigravity ACP server | ${tools['antigravity-acp'].version} |`)
if (includes('opencode')) lines.push(`| OpenCode | ${tools.opencode.version} |`)
lines.push('', '## Container images', '')
for (const name of PROVIDERS.filter(includes))
  lines.push(
    `- \`ghcr.io/nuphos/runtime:${runtime.version}-${name === 'claude' ? 'claude-code' : name}\``,
  )
lines.push(
  '',
  'Publishing these images does not deploy them to existing runtimes or update the Desktop bundle.',
)
if (previous) lines.push('', `[Full changelog](${repo}/compare/${previous}...${tag})`)
console.log(lines.join('\n'))
