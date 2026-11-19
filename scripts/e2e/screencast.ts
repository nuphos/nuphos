// A recording of the window while `run` goes on: JPEG frames in <artifacts>/<dir>, and
// <dir>.txt to join them with `ffmpeg -f concat -safe 0 -i <dir>.txt <dir>.mp4`.
import { mkdirSync, writeFileSync } from 'node:fs'

import { artifacts } from './processes.ts'

import type { Page } from 'playwright-core'

export async function recordScreencast<T>(page: Page, dir: string, run: () => Promise<T>) {
  const cdp = await page.context().newCDPSession(page)

  mkdirSync(`${artifacts}/${dir}`, { recursive: true })
  let frame = 0
  const times: { file: string; timestamp: number }[] = []

  cdp.on('Page.screencastFrame', (event) => {
    const file = `${dir}/${String(frame++).padStart(5, '0')}.jpg`

    writeFileSync(`${artifacts}/${file}`, Buffer.from(event.data, 'base64'))
    times.push({ file, timestamp: event.metadata.timestamp ?? Date.now() / 1000 })
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 75,
    maxWidth: 1440,
    maxHeight: 1000,
    everyNthFrame: 2,
  })
  try {
    return await run()
  } finally {
    await cdp.send('Page.stopScreencast')
    // Each frame's epoch seconds, to find a moment the run logged.
    writeFileSync(`${artifacts}/${dir}.json`, JSON.stringify(times))
    writeFileSync(
      `${artifacts}/${dir}.txt`,
      times
        .map(
          (frame, index) =>
            `file '${frame.file}'\nduration ${Math.min(3, Math.max(0.04, (times[index + 1]?.timestamp ?? frame.timestamp + 1) - frame.timestamp))}`,
        )
        .join('\n'),
    )
  }
}
