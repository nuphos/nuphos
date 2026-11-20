import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'
import { useObservability } from '@/lib/test/doubles/observability'

import { startFirstTeamBox } from './box-first-team'

import type { FirstTeamBoxDeps } from './box-first-team'

const events: string[] = []

useObservability({
  logEvent: (_level, event) => {
    events.push(event)
  },
  logError: (event) => {
    events.push(event)
  },
})

const saved = { ...config.box }
const savedUrl = config.agent.publicBackendUrl
const created: string[] = []

function deps(owned: number, fail = false): FirstTeamBoxDeps {
  return {
    ownedTeams: () => Promise.resolve(owned),
    create: (userId, teamId, label) => {
      if (fail) return Promise.reject(new Error('instabox is busy'))
      created.push(`${userId}/${teamId}/${label}`)

      return Promise.resolve({})
    },
  }
}

beforeEach(() => {
  events.length = 0
  created.length = 0
  config.box.instabox = { apiKey: 'ibk_test' }
  config.box.defaultVcpuLimit = 2
  config.box.defaultMonthlyHours = 50
  config.agent.publicBackendUrl = 'https://api.example.test'
})

afterEach(() => {
  Object.assign(config.box, saved)
  delete config.box.defaultMonthlyHours
  config.agent.publicBackendUrl = savedUrl
})

describe('the first team’s free Box', () => {
  test('starts for the first team a user makes', async () => {
    await startFirstTeamBox('u1', 't1', deps(1))

    expect(created).toEqual(['u1/t1/Computer 1'])
    expect(events).toContain('agent.box.first_team_started')
  })

  test('does not start for a later team', async () => {
    await startFirstTeamBox('u1', 't2', deps(2))

    expect(created).toEqual([])
  })

  test('does not start where the deployment gives no free Box', async () => {
    delete config.box.defaultMonthlyHours
    await startFirstTeamBox('u1', 't1', deps(1))

    expect(created).toEqual([])
  })

  test('does not start where the deployment has no instabox', async () => {
    config.box.instabox = null
    await startFirstTeamBox('u1', 't1', deps(1))

    expect(created).toEqual([])
  })

  test('a Box that cannot start is logged, not thrown', async () => {
    await startFirstTeamBox('u1', 't1', deps(1, true))

    expect(events).toContain('agent.box.first_team_failed')
  })
})
