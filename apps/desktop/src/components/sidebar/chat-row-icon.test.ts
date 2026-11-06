import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// chat-row-icon.tsx renders JSX, which these tests can't import, so read its source.
const source = readFileSync(new URL('./chat-row-icon.tsx', import.meta.url), 'utf8')

test("a chat row wears its members' faces, not a channel mark (#1496)", () => {
  const channelBranch = source.slice(
    source.indexOf("conversation.kind === 'channel'"),
    source.indexOf('const avatar'),
  )

  assert.match(channelBranch, /<ChatIcon\s+faces=\{conversation\.faces\}/)
  assert.doesNotMatch(source, /\bHash\b/)
})
