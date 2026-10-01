import { createHash } from 'node:crypto'

import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { appendScriptVersion, serializePanel, serializeSnapshot } from '@/routes/dashboards'

import type { DashboardPanel, DashboardPanelScriptVersion, DashboardPanelSnapshot } from '@/models'

const now = new Date('2026-07-16T00:00:00.000Z')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

function v(version: number, code: string): DashboardPanelScriptVersion {
  return { version, code, codeHash: hash(code), authoredBy: 'u1', createdAt: now }
}

describe('appendScriptVersion', () => {
  test('editing code twice yields scriptVersion 3 with 3 versions', () => {
    let versions = [v(1, 'const a = 1')]
    let scriptVersion = 1

    const first = appendScriptVersion(versions, scriptVersion, 'const a = 2', 'u2', now)

    expect(first).not.toBeNull()
    versions = first!.versions
    scriptVersion = first!.scriptVersion
    expect(scriptVersion).toBe(2)

    const second = appendScriptVersion(versions, scriptVersion, 'const a = 3', 'u3', now)

    expect(second).not.toBeNull()
    versions = second!.versions
    scriptVersion = second!.scriptVersion

    expect(scriptVersion).toBe(3)
    expect(versions).toHaveLength(3)
    expect(versions.map((x) => x.version)).toEqual([1, 2, 3])
    expect(versions.at(-1)!.code).toBe('const a = 3')
    expect(versions.at(-1)!.authoredBy).toBe('u3')
  })

  test('re-saving identical head code is a no-op', () => {
    const versions = [v(1, 'x'), v(2, 'y')]

    expect(appendScriptVersion(versions, 2, 'y', 'u1', now)).toBeNull()
  })

  test('trims to the most recent N versions', () => {
    let versions = [v(1, 'c0')]
    let scriptVersion = 1

    for (let i = 1; i <= 5; i++) {
      const r = appendScriptVersion(versions, scriptVersion, `c${String(i)}`, 'u1', now, 3)

      versions = r!.versions
      scriptVersion = r!.scriptVersion
    }
    expect(scriptVersion).toBe(6)
    expect(versions).toHaveLength(3)
    // Oldest dropped; newest kept.
    expect(versions.map((x) => x.version)).toEqual([4, 5, 6])
  })
})

describe('serializeSnapshot', () => {
  test('never exposes legacy persisted stderr', () => {
    const snapshot = {
      _id: new ObjectId(),
      panelId: new ObjectId(),
      dashboardId: new ObjectId(),
      scriptVersion: 1,
      codeHash: 'code',
      params: {},
      paramsHash: 'params',
      requestedAt: now,
      status: 'failed',
      error: {
        message: 'Panel execution failed',
        kind: 'nonzero_exit',
        stderr: 'NUPHOS_TOKEN=secret',
      },
      createdAt: now,
    } as unknown as DashboardPanelSnapshot

    expect(serializeSnapshot(snapshot).error).toEqual({
      message: 'Panel execution failed',
      kind: 'nonzero_exit',
    })
  })
})

describe('serializePanel', () => {
  test('keeps the last successful output separate from a failed current run', () => {
    const panelId = new ObjectId()
    const dashboardId = new ObjectId()
    const base = {
      panelId,
      dashboardId,
      teamId: new ObjectId(),
      scriptVersion: 1,
      codeHash: 'code',
      params: {},
      paramsHash: 'params',
      requestedAt: now,
      expiresAt: now,
      createdAt: now,
    }
    const failed = {
      ...base,
      _id: new ObjectId(),
      status: 'failed',
      error: { message: 'panel exited with code 1', kind: 'nonzero_exit' },
    } as DashboardPanelSnapshot
    const successful = {
      ...base,
      _id: new ObjectId(),
      status: 'complete',
      output: {
        kind: 'scalar',
        title: 'Spend',
        value: 42,
        unit: 'usd',
      },
    } as DashboardPanelSnapshot
    const panel = {
      _id: panelId,
      dashboardId,
      title: 'Spend',
      kind: 'scalar',
      scriptVersion: 1,
      versions: [v(1, 'export default async () => ({})')],
      createdBy: 'u1',
      createdAt: now,
      updatedAt: now,
    } as DashboardPanel

    const serialized = serializePanel(panel, {}, failed, undefined, successful)

    expect(serialized.currentSnapshot?.status).toBe('failed')
    expect(serialized.lastSuccessfulSnapshot?.status).toBe('complete')
    expect(serialized.lastSuccessfulSnapshot?.output).toEqual(successful.output)
  })
})
