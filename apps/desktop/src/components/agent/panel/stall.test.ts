import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

let normalizeAgentError: (message: unknown) => string

before(async () => {
  mock.module('../../../api.ts', { namedExports: { isNetworkError: () => false } })
  mock.module('../../../i18n/index.ts', { namedExports: { t: (text: string) => text } })
  mock.module('../../../lib/frontendErrorReporter.ts', {
    namedExports: { reportFrontendError: () => {} },
  })
  mock.module('../../../lib/ownedAgentStreams.ts', {
    namedExports: { markOwnedAgentStream: () => {} },
  })
  ;({ normalizeAgentError } = await import('./stall.ts'))
})

test('error text still loses its diagnostic context tail', () => {
  assert.equal(normalizeAgentError('Boom\ncontext=phase=run streamId=s1'), 'Boom')
  assert.equal(normalizeAgentError(undefined), 'undefined')
})
