import { describe, expect, test } from 'bun:test'

import { assertCloudRegion, cloudRegionSchema } from './cloud-region'
import { volcCall } from './volcengine-api'

import type { VolcengineHandle } from './volcengine-api'

describe('cloudRegionSchema', () => {
  test('accepts provider region ids', () => {
    for (const region of [
      'us-east-1',
      'us-gov-west-1',
      'cn-beijing',
      'cn-hangzhou',
      'ap-southeast-3',
    ]) {
      expect(cloudRegionSchema.safeParse(region).success).toBe(true)
    }
  })

  test('rejects anything that could change a hostname', () => {
    for (const region of [
      '',
      'us-east-1.',
      'x@127.0.0.1/',
      'evil.example?',
      'a#b',
      'US-EAST-1',
      ' us-east-1',
    ]) {
      expect(cloudRegionSchema.safeParse(region).success).toBe(false)
    }
  })
})

describe('provider clients', () => {
  test('volcCall refuses an invalid region before sending anything', () => {
    const handle = {
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      sessionToken: 'st',
    } as VolcengineHandle

    expect(() => volcCall(handle, 'vke', 'x@127.0.0.1/', 'ListClusters', '2022-05-12', {})).toThrow(
      'Invalid region',
    )
  })

  test('assertCloudRegion returns a valid region unchanged', () => {
    expect(assertCloudRegion('cn-beijing')).toBe('cn-beijing')
  })
})
