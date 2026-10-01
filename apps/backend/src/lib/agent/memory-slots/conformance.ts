// Shared SPI conformance suite (spec §d): every provider bundle's test file
// calls describeMemoryProviderConformance with its own harness — native runs
// the EXACT same suite a vendor bundle runs (decision 10's acid test). The
// suite auto-skips absent slots but ALWAYS prints the slot matrix — a missing
// slot is visible, never silent. On suite/adapter mismatch: fix the ADAPTER,
// never weaken the suite.
//
// Checklist coverage: items 1–9 and 11. Items 10 (no effectiveness writes)
// and 12 (call-site import guard) are repo-level grep guards in
// boundaries.test.ts — noted in the banner.

import { beforeEach, describe, expect, test } from 'bun:test'

import { abortOpts, viewerOf } from './conformance-harness'
import { registerRecordsConformanceCases } from './conformance-records'
import { capabilitiesOf } from './runtime'
import { MEMORY_SPI_VERSION } from './types'

import type { ConformanceHarness, ConformanceTenant } from './conformance-harness'
import type { MemoryObserver, MemorySavedEvent, MemorySessionOrigin } from './types'

export type { ConformanceHarness, ConformanceTenant } from './conformance-harness'

const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/

export function describeMemoryProviderConformance(makeHarness: () => ConformanceHarness): void {
  const harness = makeHarness()
  const provider = harness.provider
  const caps = capabilitiesOf(provider)

  // Slot matrix banner — printed unconditionally so an absent slot is
  // visible in every run, never silently skipped.
  console.log(
    [
      `┌─ memory SPI v${String(MEMORY_SPI_VERSION)} conformance — provider '${provider.meta.id}' (${provider.meta.dataResidency})`,
      `│ recall=${String(caps.recall)} tools=${String(caps.tools)} ingest=${String(caps.ingest)} records=${String(caps.records)}` +
        ` recordsDelete=${String(caps.recordsDelete)} recordsRestore=${String(caps.recordsRestore)}` +
        ` feedback=${String(caps.feedback)} webhook=${String(caps.webhook)} purge=${String(caps.purge)} cursorTier=${caps.cursorTier ?? '—'}`,
      `└─ items 10 & 12 (no effectiveness writes; call-site imports) are grep guards in boundaries.test.ts`,
    ].join('\n'),
  )

  const seedOrThrow = async (
    tenant: ConformanceTenant,
    input: { text: string; title: string },
    opts?: { origin?: MemorySessionOrigin; observer?: MemoryObserver },
  ): Promise<string> => {
    const id = await harness.seed(tenant, input, opts)

    if (!id) throw new Error('harness.seed returned null for a user-origin write')

    return id
  }

  describe(`memory SPI conformance — ${provider.meta.id}`, () => {
    beforeEach(() => harness.cleanup())

    test('1. identity & registration: id shape, prefix, idempotent setup, fast availability', async () => {
      expect(provider.meta.id).toMatch(ID_PATTERN)
      expect(provider.meta.id).not.toBe('runtime')
      expect(provider.meta.spiVersion).toBe(MEMORY_SPI_VERSION)
      expect(provider.collectionPrefix).toBe(`memory_${provider.meta.id}_`)
      if (provider.meta.dataResidency === 'external') {
        expect(provider.meta.vendorName).toBeTruthy()
      }
      // Idempotent: run twice, no throw.
      await provider.setup()
      await provider.setup()
      // Cheap (no per-call network): the real contract is "never throws";
      // the loose 1s bound only catches a probe doing per-call network I/O
      // without tripping on CI GC pauses or a vendor fake's first call.
      const started = Date.now()
      const availability = await provider.availability({ teamId: harness.tenantA.teamId })

      expect(Date.now() - started).toBeLessThan(1_000)
      expect(['ready', 'unconfigured', 'error']).toContain(availability.state)
    })

    registerRecordsConformanceCases({ harness, provider, caps, seedOrThrow })

    test.skipIf(!caps.recall)(
      '7a. non-blocking recall under fault injection: resolves, never rejects',
      async () => {
        let rejected: unknown = null
        const rendered = await harness
          .withFaultInjection(() =>
            provider.recall!.render(
              {
                userId: harness.tenantA.userId,
                teamId: harness.tenantA.teamId,
                query: 'fault injection probe',
                conversationId: 'conformance-fault-recall',
              },
              abortOpts(),
            ),
          )
          .catch((err: unknown) => {
            rejected = err

            return null
          })

        expect(rejected).toBeNull()
        // Under a failing store the only honest answers are "no context" or a
        // degraded-notice context — never an exception into the turn.
        if (rendered !== null) expect(Array.isArray(rendered.recalled)).toBe(true)
      },
    )

    test.skipIf(!caps.ingest)(
      '7b. non-blocking ingest under fault injection: never rejects into the caller',
      async () => {
        let rejected: unknown = null
        const outcome = await harness
          .withFaultInjection(() =>
            provider.ingest!.onTurnFinished(harness.makeTurnDigest(harness.tenantA), abortOpts()),
          )
          .catch((err: unknown) => {
            rejected = err

            return null
          })

        expect(rejected).toBeNull()
        if (outcome !== null) expect(Array.isArray(outcome.saved)).toBe(true)
      },
    )

    test.skipIf(!caps.tools)(
      '8. origin gating: durable writes via tools refused unless origin === user',
      async () => {
        for (const origin of ['trigger'] as const) {
          expect(
            await harness.seed(
              harness.tenantA,
              { text: `origin-gated write via ${origin}`, title: 'must not land' },
              { origin },
            ),
          ).toBeNull()
        }
        // The same write succeeds for a user-origin turn — the gate is the
        // origin, not the payload.
        expect(
          await harness.seed(harness.tenantA, {
            text: 'origin-gated write via user',
            title: 'lands fine',
          }),
        ).not.toBeNull()
      },
    )

    test.skipIf(!caps.tools || !caps.records)(
      '9. observer corroboration: saved ids resolve through records.get',
      async () => {
        const saved: MemorySavedEvent[] = []
        const observer: MemoryObserver = {
          saved: (e) => saved.push(e),
          fetched: () => {},
          searched: () => {},
        }
        const id = await seedOrThrow(
          harness.tenantA,
          { text: 'observer corroboration payload', title: 'corroborate me' },
          { observer },
        )

        expect(saved.map((e) => e.id)).toContain(id)
        for (const event of saved) {
          expect(await provider.records!.get(event.id, viewerOf(harness.tenantA))).not.toBeNull()
        }
      },
    )

    test.skipIf(!harness.listStoreCollections)(
      '11. collection prefix: every store collection is prefix-carrying or in the declared manifest',
      async () => {
        await provider.setup()
        const names = await harness.listStoreCollections!()
        const grandfathered = new Set(provider.storageDescriptor?.().collections ?? [])

        for (const name of names) {
          expect(
            name.startsWith(provider.collectionPrefix) || grandfathered.has(name),
            `collection '${name}' is neither '${provider.collectionPrefix}*' nor in storageDescriptor()`,
          ).toBe(true)
        }
      },
    )
  })
}
