import { describe, expect, test } from 'bun:test'

import { missingGoogle } from './tick-own-google-credentials'

describe('missingGoogle', () => {
  const grants = new Map([['owner:team-a', ['gmail', 'google-calendar']]])

  test('adds the Google grants the owner connected in that team, once', () => {
    expect(missingGoogle(grants, 'owner', 'team-a', ['github', 'linear'])).toEqual([
      'gmail',
      'google-calendar',
    ])
    expect(missingGoogle(grants, 'owner', 'team-a', ['github', 'gmail'])).toEqual([
      'google-calendar',
    ])
    expect(missingGoogle(grants, 'owner', 'team-a', ['gmail', 'google-calendar'])).toEqual([])
  })

  test('nothing in another team, for another member, or without a team', () => {
    expect(missingGoogle(grants, 'owner', 'team-b', [])).toEqual([])
    expect(missingGoogle(grants, 'teammate', 'team-a', [])).toEqual([])
    expect(missingGoogle(grants, 'owner', undefined, [])).toEqual([])
  })
})
