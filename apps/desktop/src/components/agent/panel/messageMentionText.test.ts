import assert from 'node:assert/strict'
import { test } from 'node:test'

import { linkMentions, parseMentions } from './messageMentionText.ts'

const mei = { id: 'u-mei', displayName: 'Mei Chen' }
const daniel = { id: 'u-daniel', displayName: 'daniel_t@example.com' }

test('a mentioned name becomes a link to that person', () => {
  assert.equal(
    linkMentions('@Mei Chen can you approve?', [mei]),
    '[@Mei Chen](#mention:u-mei) can you approve?',
  )
})

test('a name that is an email is escaped, so it is not italicized or autolinked', () => {
  assert.equal(
    linkMentions('@daniel_t@example.com Hi', [daniel]),
    String.raw`[@daniel\_t@example.com](#mention:u-daniel) Hi`,
  )
})

test('only the mentioned names, whole, and not inside an email address', () => {
  const text = 'mail mei@Mei Chen.dev or @Mei Chenko, but @Mei Chen yes'

  assert.equal(
    linkMentions(text, [mei]),
    'mail mei@Mei Chen.dev or @Mei Chenko, but [@Mei Chen](#mention:u-mei) yes',
  )
  assert.equal(linkMentions('@Someone else', [mei]), '@Someone else')
  assert.equal(linkMentions('@Mei Chen', undefined), '@Mei Chen')
})

test('the longest name wins when one name starts another', () => {
  const mei2 = { id: 'u-mei2', displayName: 'Mei' }

  assert.equal(
    linkMentions('@Mei and @Mei Chen', [mei2, mei]),
    '[@Mei](#mention:u-mei2) and [@Mei Chen](#mention:u-mei)',
  )
})

test('mentions keep only well-formed entries', () => {
  assert.deepEqual(parseMentions([mei, { id: 'x' }, null, 'u-1']), [mei])
  assert.equal(parseMentions('nope'), undefined)
  assert.equal(parseMentions([]), undefined)
})
