import { describe, expect, test } from 'bun:test'

import { missingGoogle } from './tick-google-personal-credentials'

describe('missingGoogle', () => {
  const grants = new Map([['owner:team-a', ['gmail', 'google-calendar']]])

  test('ticks the Google grants the owner connected in that team, once', () => {
    expect(missingGoogle(grants, 'owner', 'team-a', undefined)).toEqual([
      'gmail',
      'google-calendar',
    ])
    expect(missingGoogle(grants, 'owner', 'team-a', ['github', 'gmail'])).toEqual([
      'google-calendar',
    ])
  })

  test('nothing in another team, for another member, or without a team', () => {
    expect(missingGoogle(grants, 'owner', 'team-b', [])).toEqual([])
    expect(missingGoogle(grants, 'teammate', 'team-a', [])).toEqual([])
    expect(missingGoogle(grants, 'owner', undefined, [])).toEqual([])
  })
})
