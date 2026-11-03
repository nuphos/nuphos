import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RuntimeInstance } from '../../../types/runtime'

// Spanish, chosen the way the app chooses it: the saved locale, read once when i18n loads.
const events = new EventTarget()

Object.assign(globalThis, {
  window: globalThis,
  addEventListener: events.addEventListener.bind(events),
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (key: string) => (key === 'nuphos.locale' ? 'es' : null) },
})

const { t } = await import('../../../i18n/index.ts')
const { selectorBoxes } = await import('./selectorBoxes.ts')

function agent(id: string, deviceId: string, online: boolean): RuntimeInstance {
  return {
    id,
    provider: 'claude-code',
    label: id,
    status: 'active',
    kind: 'local',
    createdAt: '2026-10-22T00:00:00Z',
    local: {
      ownerUserId: 'u1',
      deviceId,
      deviceLabel: `${deviceId} label`,
      online,
      signedIn: true,
    },
  }
}

test('an offline computer is one offline row, listed last, in any language', () => {
  assert.equal(t('Offline'), 'Sin conexión')
  const groups = selectorBoxes([agent('away', 'mac', false), agent('here', 'box', true)])

  assert.deepEqual(
    groups.map((group) => [group.id, group.unavailable]),
    [
      ['device:box', null],
      ['device:mac', 'Offline'],
    ],
  )
})
