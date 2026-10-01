import { describe, expect, it, spyOn } from 'bun:test'

import { flagStalledSession, sanitizeRuntimeUrl, teamSessionsInInventory } from './runtime-status'

describe('sanitizeRuntimeUrl', () => {
  it('drops userinfo, query, and fragment from a self-hosted runtime url', () => {
    expect(sanitizeRuntimeUrl('wss://user:password@host.example/acp?token=secret#frag')).toBe(
      'wss://host.example/acp',
    )
  })

  it('leaves an ordinary url unchanged apart from its trailing parts', () => {
    expect(sanitizeRuntimeUrl('https://runtime.example/path')).toBe('https://runtime.example/path')
  })

  it('falls back to a placeholder for an unparseable url', () => {
    expect(sanitizeRuntimeUrl('not a url')).toBe('[unparseable runtime url]')
  })
})

describe('flagStalledSession', () => {
  it('does not log when there is no activityPhase', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    flagStalledSession('team-1', 'https://runtime.example', { state: 'active' })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not log an idle session regardless of elapsed time', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    flagStalledSession('team-1', 'https://runtime.example', {
      state: 'idle',
      activityPhase: { phase: 'idle', phaseElapsedMs: 10 * 60 * 1000 },
    })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not log a prompt_in_flight session below the threshold', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    flagStalledSession('team-1', 'https://runtime.example', {
      state: 'active',
      activityPhase: { phase: 'prompt_in_flight', phaseElapsedMs: 30 * 1000 },
    })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('logs openab.runtime.session_stalled once a non-permission phase crosses the threshold', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    flagStalledSession('team-1', 'https://runtime.example', {
      state: 'active',
      activityPhase: { phase: 'prompt_in_flight', phaseElapsedMs: 3 * 60 * 1000 },
    })
    expect(warn).toHaveBeenCalledTimes(1)
    const line = JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<string, unknown>

    expect(line.event).toBe('openab.runtime.session_stalled')
    expect(line.team_id).toBe('team-1')
    expect(line.phase).toBe('prompt_in_flight')
    warn.mockRestore()
  })

  it('gives a permission wait a longer threshold before flagging it', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    flagStalledSession('team-1', 'https://runtime.example', {
      state: 'active',
      activityPhase: { phase: 'prompt_permission_wait', phaseElapsedMs: 3 * 60 * 1000 },
    })
    expect(warn).not.toHaveBeenCalled()

    flagStalledSession('team-1', 'https://runtime.example', {
      state: 'active',
      activityPhase: { phase: 'prompt_permission_wait', phaseElapsedMs: 11 * 60 * 1000 },
    })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

const ownsMine = (_teamId: string, ids: string[]) =>
  Promise.resolve(new Set(ids.filter((id) => id === 'sess_mine')))

describe('teamSessionsInInventory', () => {
  const stalled = { phase: 'prompt_in_flight', phaseElapsedMs: 5 * 60 * 1000 }
  const inventory = [
    { sessionId: 'sess_mine', state: 'active', activityPhase: stalled },
    { sessionId: 'sess_other_team', state: 'active', activityPhase: stalled },
  ]

  it('counts and flags only the requesting team sessions on a shared runtime', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    const mine = await teamSessionsInInventory(
      'team-1',
      'https://runtime.example',
      inventory,
      ownsMine,
    )

    expect(mine?.map((session) => session.sessionId)).toEqual(['sess_mine'])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('neither counts nor flags an inventory it cannot attribute', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    const mine = await teamSessionsInInventory(
      'team-1',
      'https://runtime.example',
      [{ state: 'active', activityPhase: stalled }],
      ownsMine,
    )

    expect(mine).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
