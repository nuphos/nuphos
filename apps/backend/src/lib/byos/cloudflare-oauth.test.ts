import { describe, expect, test } from 'bun:test'

import { resolveCloudflareScopeParam } from './cloudflare-oauth'

describe('resolveCloudflareScopeParam', () => {
  test('drops metadata_read scopes Cloudflare does not offer OAuth clients', () => {
    expect(
      resolveCloudflareScopeParam([
        'd1.metadata_read',
        'd1.read',
        'workers-r2.metadata_read',
        'workers-scripts.metadata_read',
        'workers_ai.metadata_read',
      ]),
    ).toBe('d1.read workers-scripts.metadata_read offline_access')
  })
})
