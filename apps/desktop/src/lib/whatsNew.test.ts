import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hasUnread } from './whatsNew.ts'

import type { ChangelogEntry } from '../types/team.ts'

function entry(slug: string): ChangelogEntry {
  return {
    slug,
    title: slug,
    summary: '',
    date: '2026-08-12',
    coverUrl: 'https://nuphos.ai/c.png',
    url: `https://nuphos.ai/changelog/${slug}`,
  }
}

const feed = [entry('newest'), entry('older'), entry('oldest')]

describe('hasUnread', () => {
  it('is true when the newest slug differs from last seen', () => {
    assert.equal(hasUnread(feed, null), true)
    assert.equal(hasUnread(feed, 'older'), true)
  })

  it('is false when newest was seen, or feed is empty', () => {
    assert.equal(hasUnread(feed, 'newest'), false)
    assert.equal(hasUnread([], null), false)
  })
})
