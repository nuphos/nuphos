import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addCard } from './homeAddCard.ts'

test('addCard adds a card of each kind and names its grid key', () => {
  const layout = { team: false, github: [], panels: [], metrics: [] }

  assert.deepEqual(addCard(layout, 'team', 'x'), { layout: { ...layout, team: true }, key: 'team' })
  assert.deepEqual(addCard(layout, 'ci', 'c1'), {
    layout: { ...layout, github: [{ id: 'c1', kind: 'ci', repos: [], statuses: ['failed'] }] },
    key: 'gh:c1',
  })
  const repos = [{ installationId: 1, fullName: 'o/app' }]
  const pulls = addCard(layout, 'pulls', 'p1', { repos, statuses: ['draft'] })

  assert.deepEqual(pulls.layout.github, [{ id: 'p1', kind: 'pulls', repos, statuses: ['draft'] }])
  assert.deepEqual(addCard(layout, 'streak', 'm1'), {
    layout: { ...layout, metrics: [{ id: 'm1', kind: 'streak', range: '7d', scope: 'me' }] },
    key: 'metric:streak:m1',
  })
})
