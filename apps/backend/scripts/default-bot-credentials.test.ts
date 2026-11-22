import { describe, expect, test } from 'bun:test'

import { parseArgs } from './default-bot-credentials'

const TEAM = '69e989027ab63e8d6a0ffcb6'

describe('parseArgs', () => {
  test('a dry run may count every team; writing names its teams', () => {
    expect(parseArgs([])).toEqual({ apply: false, teams: [], record: undefined })
    expect(parseArgs(['--apply', '--team', TEAM, '--record', 'rollback.json'])).toEqual({
      apply: true,
      teams: [TEAM],
      record: 'rollback.json',
    })
  })

  test('a forgotten, swallowed or mistyped team never writes to every team', () => {
    expect(() => parseArgs(['--apply'])).toThrow('--apply needs at least one --team')
    expect(() => parseArgs(['--apply', '--team'])).toThrow('Unexpected argument: --team')
    expect(() => parseArgs(['--team', '--apply'])).toThrow('Unexpected argument: --team')
    expect(() => parseArgs(['--apply', '--teams', TEAM])).toThrow('Unexpected argument: --teams')
    expect(() => parseArgs(['--apply', '--team', 'ours'])).toThrow('--team takes a team id')
  })
})
