import { describe, expect, test } from 'bun:test'

import { anchorOnce, buildTimestampRequest } from './anchor'

import type { AnchorDeps } from './anchor'
import type { SealStateDoc } from './sealer'
import type { Collection } from 'mongodb'

function makeDeps(state: SealStateDoc | null) {
  const objects = new Map<string, string | Uint8Array>()
  const gitLines: string[] = []
  const tsaRequests: Uint8Array[] = []
  const deps: AnchorDeps = {
    state: {
      findOne: async () => state,
      updateOne: async (_filter: unknown, update: { $set?: Partial<SealStateDoc> }) => {
        if (state) Object.assign(state, update.$set ?? {})

        return { matchedCount: state ? 1 : 0, upsertedCount: 0 }
      },
    } as unknown as Collection<SealStateDoc>,
    putObject: async (key, body) => {
      objects.set(key, body)
    },
    requestTimestamp: async (request) => {
      tsaRequests.push(request)

      return new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00])
    },
    appendGitAnchor: async (line) => {
      gitLines.push(line)
    },
    now: () => new Date('2026-07-03T03:00:00.000Z'),
  }

  return { deps, objects, gitLines, tsaRequests }
}

describe('buildTimestampRequest', () => {
  test('golden DER encoding (frozen: verifiers depend on it)', () => {
    expect(Buffer.from(buildTimestampRequest('aa'.repeat(32))).toString('hex')).toBe(
      `30390201013031300d060960864801650304020105000420${'aa'.repeat(32)}0101ff`,
    )
  })

  test('rejects non-sha256 digests', () => {
    expect(() => buildTimestampRequest('abcd')).toThrow(/sha256/)
  })
})

describe('anchorOnce', () => {
  test('skips when no segments exist yet', async () => {
    const { deps, objects } = makeDeps({
      _id: '__global__',
      segmentCounter: 0,
      lastSegmentHash: '0'.repeat(64),
      pending: null,
    })
    const result = await anchorOnce(deps)

    expect(result.anchored).toBe(false)
    expect(objects.size).toBe(0)
  })

  test('anchors the chain head to TSA + git + WORM record', async () => {
    const head = 'c'.repeat(64)
    const { deps, objects, gitLines, tsaRequests } = makeDeps({
      _id: '__global__',
      segmentCounter: 7,
      lastSegmentHash: head,
      pending: null,
    })

    const result = await anchorOnce(deps)

    expect(result).toMatchObject({ anchored: true, date: '2026-07-03', tsa: true, git: true })
    expect(tsaRequests).toHaveLength(1)
    expect(objects.has('anchors/2026-07-03.tsr')).toBe(true)
    const record = JSON.parse(objects.get('anchors/2026-07-03.json') as string) as {
      lastSegmentHash: string
      anchoredDigest: string
    }

    expect(record.lastSegmentHash).toBe(head)
    expect(gitLines[0]).toContain(head)
    expect(gitLines[0]).toContain(record.anchoredDigest)
  })

  test('a failing TSA does not block the git anchor or the WORM record', async () => {
    const { deps, objects, gitLines } = makeDeps({
      _id: '__global__',
      segmentCounter: 1,
      lastSegmentHash: 'd'.repeat(64),
      pending: null,
    })

    deps.requestTimestamp = async () => {
      throw new Error('TSA down')
    }
    const result = await anchorOnce(deps)

    expect(result.anchored).toBe(true)
    expect(result.tsa).toBe(false)
    expect(result.git).toBe(true)
    expect(gitLines).toHaveLength(1)
    expect(objects.has('anchors/2026-07-03.json')).toBe(true)
  })

  test('does not mark history anchored when every external anchor fails', async () => {
    const state: SealStateDoc = {
      _id: '__global__',
      segmentCounter: 1,
      lastSegmentHash: 'e'.repeat(64),
      pending: null,
    }
    const { deps, objects } = makeDeps(state)

    deps.requestTimestamp = async () => {
      throw new Error('TSA down')
    }
    deps.appendGitAnchor = async () => {
      throw new Error('Git down')
    }

    const result = await anchorOnce(deps)

    expect(result).toMatchObject({ anchored: false, tsa: false, git: false })
    expect(state.lastAnchorAt).toBeUndefined()
    expect(state.lastAnchoredSegmentHash).toBeUndefined()
    expect(objects.has('anchors/2026-07-03.json')).toBe(true)
  })
})
