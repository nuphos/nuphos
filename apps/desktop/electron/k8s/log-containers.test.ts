import assert from 'node:assert/strict'
import test from 'node:test'

import { podLogContainers } from './log-containers.ts'

test('logs include app, init, and ephemeral container instances', () => {
  const containers = podLogContainers({
    metadata: {},
    spec: {
      containers: [{ name: 'app', image: 'app' }],
      initContainers: [{ name: 'setup', image: 'setup' }],
      ephemeralContainers: [{ name: 'debug', image: 'debug', targetContainerName: 'app' }],
    },
    status: {
      containerStatuses: [
        { name: 'app', image: 'app', imageID: '', ready: false, restartCount: 2 },
      ],
      initContainerStatuses: [
        { name: 'setup', image: 'setup', imageID: '', ready: false, restartCount: 1 },
      ],
      ephemeralContainerStatuses: [
        { name: 'debug', image: 'debug', imageID: '', ready: false, restartCount: 0 },
      ],
    },
  })

  assert.deepEqual(containers, [
    { name: 'app', instance: 2 },
    { name: 'setup', instance: 1 },
    { name: 'debug', instance: 0 },
  ])
})
