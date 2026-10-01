import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseChangelogFeed } from './changelog-feed.ts'

const entry = {
  slug: 'slack-message-origin',
  title: 'Slack 訊息來源標示',
  summary: '現在每則 Slack 訊息都會標示來源對話。',
  date: '2026-08-12',
  coverUrl: 'https://nuphos.ai/changelog-assets/cover.png',
  url: 'https://nuphos.ai/changelog/slack-message-origin',
}

describe('parseChangelogFeed', () => {
  it('accepts a valid v1 feed', () => {
    assert.deepEqual(parseChangelogFeed({ version: 1, entries: [entry] }), [entry])
  })

  it('rejects non-object / wrong version / non-array entries as null', () => {
    assert.equal(parseChangelogFeed(null), null)
    assert.equal(parseChangelogFeed('[]'), null)
    assert.equal(parseChangelogFeed({ version: 2, entries: [entry] }), null)
    assert.equal(parseChangelogFeed({ version: 1, entries: 'nope' }), null)
  })

  it('drops invalid entries but keeps valid ones', () => {
    const missingTitle = { ...entry, title: '' }
    const foreignUrl = { ...entry, url: 'https://evil.example.com/x' }
    const badDate = { ...entry, date: 'not-a-date' }

    assert.deepEqual(
      parseChangelogFeed({ version: 1, entries: [missingTitle, entry, foreignUrl, badDate] }),
      [entry],
    )
  })

  it('returns [] for a valid feed with no entries', () => {
    assert.deepEqual(parseChangelogFeed({ version: 1, entries: [] }), [])
  })
})
