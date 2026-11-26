// #5133: a Bot imported from a bundle starts in Full Access, as one made with "+" does, and
// its first turn runs a tool call without asking anyone.
import { client } from './binding-access-scenarios.ts'
import { artifacts } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

const NAME = 'E2E Imported Bot'
const MARKER = 'E2E_DELIVERY:imported'

// A stored (uncompressed) ZIP, enough for the backend's bundle reader.
function zip(files: [string, string][]) {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  for (const [path, text] of files) {
    const name = Buffer.from(path)
    const data = Buffer.from(text)
    let crc = -1

    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    crc = (crc ^ -1) >>> 0
    const header = Buffer.alloc(30)

    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    locals.push(header, name, data)
    const central = Buffer.alloc(46)

    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(0x314, 4)
    header.copy(central, 6, 4, 26)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0x81a4 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)
    offset += header.length + name.length + data.length
  }
  const entries = Buffer.concat(directory)
  const end = Buffer.alloc(22)

  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(entries.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, entries, end])
}

const bundle = zip([
  [
    'manifest.json',
    JSON.stringify({
      format: 'nuphos-bot-bundle',
      version: 1,
      source: { application: 'grok-bot', exportedAt: '2026-11-26T00:00:00Z' },
      bots: [{ key: 'imported', name: NAME, instructions: 'Answer in the chat you are asked in.' }],
    }),
  ],
])

function must(ok: boolean, message: string) {
  if (!ok) throw new Error(message)
}

export const botImportModeScenarios: Scenario[] = [
  {
    name: 'an imported Bot starts in Full Access as one made with "+" does, and its first turn asks nothing',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const listed = await api('GET', `/teams/${stack.teamId}/agent-runtimes`)
      const runtimeId = (
        listed.body as { runtimes: { id: string; label: string }[] }
      ).runtimes.find((runtime) => runtime.label === 'E2E fixture agent')?.id

      must(typeof runtimeId === 'string', `the fixture agent to import into, got ${listed.status}`)
      const target = `teamId=${stack.teamId}&runtimeId=${runtimeId}&agentRuntime=claude-code`
      const previewed = await fetch(`${stack.apiUrl}/agent/bot-imports/preview?${target}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/zip' },
        body: bundle,
      })
      const preview = (await previewed.json()) as {
        id: string
        items: { kind: string; key: string; sessionId: string }[]
      }

      must(previewed.ok, `the bundle preview, got ${previewed.status} ${JSON.stringify(preview)}`)
      const applied = await api('POST', `/agent/bot-imports/${preview.id}/apply?${target}`, {
        botKeys: ['imported'],
        chatKeys: [],
        enableSchedules: false,
      })

      must(
        applied.status === 200,
        `the import, got ${applied.status} ${JSON.stringify(applied.body)}`,
      )
      const imported = preview.items.find((item) => item.key === 'imported')?.sessionId ?? ''
      const mode = async (sessionId: string) =>
        (
          (await api('GET', `/agent/auto-mode/bypass?sessionId=${sessionId}`)).body as {
            bypass: boolean
          }
        ).bypass

      // The same default as a Bot made with "+".
      const made = await api('POST', '/agent/bots', {
        teamId: stack.teamId,
        title: 'E2E Plus Bot',
        avatar: '07-ada',
        agentRuntime: 'claude-code',
      })
      const plus = (made.body as { sessionId: string }).sessionId

      must(await mode(plus), 'a Bot made with "+" to start in Full Access')
      must(await mode(imported), 'the imported Bot to start in Full Access')

      // Its first turn posts with channel_post, which Auto Mode would ask about.
      await page.getByRole('tab', { name: /^Bots/ }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: NAME }).first().click()
      await page.locator(`[aria-placeholder="Message ${NAME}"]`).waitFor()
      await send(page, `Say hello ${MARKER}`)
      await page.getByText(`POSTED ${MARKER}`, { exact: true }).waitFor()
      must(
        (await page.locator('[data-tool-approval]').count()) === 0 &&
          (await page.getByRole('button', { name: /^Allow/ }).count()) === 0,
        'the imported Bot to run its first turn without asking',
      )
      await page.emulateMedia({ colorScheme: 'light' })
      await page.screenshot({ path: `${artifacts}/imported-bot-first-turn-light.png` })
      await page.emulateMedia({ colorScheme: null })
    },
  },
]
