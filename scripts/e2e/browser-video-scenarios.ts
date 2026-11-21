// #3895: an agent records what its tab in Nuphos Desktop shows, and the video plays.
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { PLAY_VIDEO, servePage } from './cli-browser-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

type Content = { type: string; text?: string; data?: string }

export const recordsTabAsVideo: Scenario = {
  name: 'an agent records its Desktop browser tab as a video that plays',
  run: async (page, stack) => {
    let recorded: string | undefined
    const site = await servePage(() => recorded)
    let step = 0
    /** One turn of this Task whose agent calls local_browser with `args`; its answer. */
    const browse = async (args: Record<string, unknown>): Promise<Content[]> => {
      const marker = `video-${String(++step)}`
      const before = agentLog(stack).length

      await send(
        page,
        `Record E2E_CALL local_browser ${JSON.stringify({ label: 'Record the tab', ...args })} E2E_DELIVERY:${marker}`,
      )
      await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
      const result = agentLog(stack)
        .slice(before)
        .find((entry) => entry.event === 'called')?.result as { content?: Content[] } | undefined

      return result?.content ?? []
    }
    const json = <T>(content: Content[]) => JSON.parse(content[0]?.text ?? 'null') as T

    try {
      await newTask(page)
      const { tab } = json<{ tab: number }>(await browse({ action: 'open', url: `${site.url}/` }))

      await browse({ action: 'record_start', tab, video: true })
      await browse({
        action: 'eval',
        tab,
        script: 'new Promise((done) => setTimeout(done, 2000))',
      })
      const stopped = await browse({ action: 'record_stop', tab })
      const video = json<{ video?: { file: string; frames: number } }>(stopped).video

      if (!video || video.frames === 0)
        throw new Error(`record_stop to return a video, got ${stopped[0]?.text ?? ''}`)
      recorded = video.file
      copyFileSync(video.file, join(artifacts, 'desktop-browser-video.webm'))

      const player = json<{ tab: number }>(
        await browse({ action: 'open', url: `${site.url}/play` }),
      )
      const played = await browse({ action: 'eval', tab: player.tab, script: PLAY_VIDEO })
      const playback = json<{ width?: number; seconds?: number }>(played)

      if (playback.width !== 1440 || (playback.seconds ?? 0) <= 1)
        throw new Error(
          `the video to play at 1440 wide for over a second, got ${played[0]?.text ?? ''}`,
        )
      const frame = await browse({ action: 'screenshot', tab: player.tab })

      writeFileSync(
        join(artifacts, 'desktop-browser-video-frame.jpg'),
        Buffer.from(frame.find((c) => c.type === 'image')?.data ?? '', 'base64'),
      )
      await browse({ action: 'close', tab })
      await browse({ action: 'close', tab: player.tab })
    } finally {
      site.close()
    }
  },
}

// Skipped while #4305 is open: a hidden Desktop tab can record no frame. Put
// `recordsTabAsVideo` back in this list when it is fixed.
export const browserVideoScenarios: Scenario[] = []
