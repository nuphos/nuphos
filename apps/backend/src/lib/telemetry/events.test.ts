import { describe, expect, test } from 'bun:test'

import TELEMETRY_EVENTS from './events.json'

const SRC = `${import.meta.dir}/../..`

describe('telemetry event allowlist', () => {
  test('lists each name once', () => {
    expect(new Set(TELEMETRY_EVENTS).size).toBe(TELEMETRY_EVENTS.length)
  })

  test('every name is still a literal logEvent() or logError() name in the backend', async () => {
    const used = new Set<string>()
    const call =
      /\blog(?:Event|Error)\(\s*(?:'(?:debug|info|warn|error)'\s*,\s*)?['"]([a-z0-9_.-]+)['"]/g

    for await (const file of new Bun.Glob('**/*.ts').scan(SRC)) {
      if (file.includes('.test.')) continue
      for (const match of (await Bun.file(`${SRC}/${file}`).text()).matchAll(call)) {
        used.add(match[1]!)
      }
    }

    expect(TELEMETRY_EVENTS.filter((name) => !used.has(name))).toEqual([])
  })
})
