import { describe, expect, test } from 'bun:test'

import { isDirectDiscordMention } from './mention'

import type { DiscordMessageCreate } from './mention'

describe('Discord mention admission shape', () => {
  test('uses structured mention IDs rather than matching display text', () => {
    const event: DiscordMessageCreate = {
      id: '123456789012345678',
      guild_id: '223456789012345678',
      channel_id: '323456789012345678',
      content: '@Nuphos investigate',
      author: { id: '423456789012345678' },
      mentions: [],
    }

    expect(isDirectDiscordMention(event, '523456789012345678')).toBe(false)
    event.mentions = [{ id: '523456789012345678' }]
    expect(isDirectDiscordMention(event, '523456789012345678')).toBe(true)
  })

  test('keeps snowflakes as strings', () => {
    const id = '999999999999999999'
    const payload = JSON.parse(JSON.stringify({ id })) as { id: unknown }

    expect(payload.id).toBe(id)
    expect(typeof payload.id).toBe('string')
    expect(Number.isSafeInteger(Number(id))).toBe(false)
  })
})
