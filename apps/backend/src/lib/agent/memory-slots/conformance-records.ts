import { expect, test } from 'bun:test'

import { byCodeUnit } from '@/lib/agent/sort-order'

import { abortOpts, viewerOf } from './conformance-harness'

import type { ConformanceContext } from './conformance-harness'

/** Items 2–6: the records/recall data-plane cases. Must be called inside the
 * suite's describe block so the tests land under the provider's banner. */
export function registerRecordsConformanceCases(ctx: ConformanceContext): void {
  const { harness, provider, caps, seedOrThrow } = ctx

  test.skipIf(!caps.records)(
    '2a. tenancy isolation — records: tenant A data invisible to tenant B',
    async () => {
      const id = await seedOrThrow(harness.tenantA, {
        text: 'tenant-a-secret fact for isolation',
        title: 'tenant A fact',
      })
      const pageB = await provider.records!.list({
        viewer: viewerOf(harness.tenantB),
        cursor: null,
        limit: 50,
        state: 'live',
      })

      expect(pageB.items.map((i) => i.id)).not.toContain(id)
      expect(await provider.records!.get(id, viewerOf(harness.tenantB))).toBeNull()
    },
  )

  test.skipIf(!caps.recall)(
    "2b. tenancy isolation — recall: tenant B's block never contains A's seeded text",
    async () => {
      await seedOrThrow(harness.tenantA, {
        text: 'tenant-a-secret recall payload',
        title: 'tenant A recall fact',
      })
      const rendered = await provider.recall!.render(
        {
          userId: harness.tenantB.userId,
          teamId: harness.tenantB.teamId,
          query: 'tenant-a-secret',
          conversationId: 'conformance-recall-b',
        },
        abortOpts(),
      )

      expect(rendered?.block ?? '').not.toContain('tenant-a-secret')
    },
  )

  test.skipIf(!caps.recordsDelete)(
    '3. delete propagation: stranger refused + store untouched; owner delete reaches the real store',
    async () => {
      const id = await seedOrThrow(harness.tenantA, {
        text: 'delete-propagation payload',
        title: 'delete me',
      })

      // Stranger delete: false, real store untouched.
      expect(await provider.records!.delete!(id, viewerOf(harness.tenantB))).toBe(false)
      expect(await harness.existsInRealStore(id)).toBe(true)
      // Owner delete: true, gone from the REAL store (vendor API / raw
      // collection), not just hidden from the wire surface.
      expect(await provider.records!.delete!(id, viewerOf(harness.tenantA))).toBe(true)
      expect(await harness.existsInRealStore(id)).toBe(false)
      expect(await provider.records!.get(id, viewerOf(harness.tenantA))).toBeNull()
      if (caps.recall) {
        const rendered = await provider.recall!.render(
          {
            userId: harness.tenantA.userId,
            teamId: harness.tenantA.teamId,
            query: 'delete-propagation',
            conversationId: 'conformance-recall-deleted',
          },
          abortOpts(),
        )

        expect(rendered?.block ?? '').not.toContain('delete-propagation payload')
      }
    },
  )

  test.skipIf(!caps.recordsDelete || !caps.recordsRestore)(
    '4. restore round-trip (absence of restore = capability signal, route 404s)',
    async () => {
      const id = await seedOrThrow(harness.tenantA, {
        text: 'restore round-trip payload',
        title: 'restore me',
      })

      expect(await provider.records!.delete!(id, viewerOf(harness.tenantA))).toBe(true)
      expect(await provider.records!.restore!(id, viewerOf(harness.tenantA))).toBe(true)
      expect(await provider.records!.get(id, viewerOf(harness.tenantA))).not.toBeNull()
      expect(await harness.existsInRealStore(id)).toBe(true)
    },
  )

  test.skipIf(!caps.records)('5. id stability: unknown ids never throw', async () => {
    for (const unknownId of ['definitely-not-an-id', '0123456789abcdef01234567']) {
      expect(await provider.records!.get(unknownId, viewerOf(harness.tenantA))).toBeNull()
      if (caps.recordsDelete) {
        expect(await provider.records!.delete!(unknownId, viewerOf(harness.tenantA))).toBe(false)
      }
    }
  })

  test.skipIf(!caps.records)(
    `6. pagination (${caps.cursorTier ?? 'n/a'} tier): cursor walk + garbage cursor reset`,
    async () => {
      const seeded: string[] = []

      for (let i = 0; i < 5; i++) {
        seeded.push(
          await seedOrThrow(harness.tenantA, {
            text: `pagination payload number ${String(i)} with distinct content`,
            title: `page item ${String(i)}`,
          }),
        )
      }
      const walked: string[] = []
      let cursor: string | null = null
      let pages = 0

      do {
        const page = await provider.records!.list({
          viewer: viewerOf(harness.tenantA),
          cursor,
          limit: 2,
          state: 'live',
        })

        // hasMore and nextCursor must agree on every page.
        expect(page.hasMore).toBe(page.nextCursor !== null)
        walked.push(...page.items.map((i) => i.id))
        cursor = page.nextCursor
        pages++
        // Both tiers: no infinite loops.
        expect(pages).toBeLessThan(20)
      } while (cursor !== null)
      if (caps.cursorTier === 'strict') {
        // Strict: complete AND duplicate-free.
        expect(new Set(walked).size).toBe(walked.length)
        expect([...walked].sort(byCodeUnit)).toEqual([...seeded].sort(byCodeUnit))
      } else {
        // Best-effort: eventual completeness (every seeded id shows up).
        for (const id of seeded) expect(walked).toContain(id)
      }
      // Garbage cursor resets to page 1 — never throws.
      const reset = await provider.records!.list({
        viewer: viewerOf(harness.tenantA),
        cursor: '%%%garbage-cursor%%%',
        limit: 50,
        state: 'live',
      })

      expect(reset.items.length).toBeGreaterThan(0)
    },
  )
}
