// #4243: Settings › Privacy saves the local runtime logs to a zip for support, secrets removed.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, globSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { artifacts, logPath } from './processes.ts'

import type { Scenario } from './ui.ts'

const unzip = (flag: '-Z1' | '-p', zip: string, member?: string) =>
  execFileSync('unzip', [flag, zip, ...(member ? [member] : [])], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

export const diagnosticsScenarios: Scenario[] = [
  {
    name: 'Settings › Privacy saves a redacted zip of the local runtime logs',
    run: async (page) => {
      const profile = /^\[user-data\] using (.+)$/m.exec(
        readFileSync(logPath('desktop'), 'utf8'),
      )![1]!
      const runtime = join(profile, 'local-runtime')
      const secret = `e2e-${randomUUID()}`
      let logs = globSync('users/*/*/openab.log', { cwd: runtime })

      // The suite's own runs leave logs; one is planted only when none ran yet.
      if (logs.length === 0) {
        mkdirSync(join(runtime, 'users', 'e2e', 'claude-code'), { recursive: true })
        logs = ['users/e2e/claude-code/openab.log']
      }
      appendFileSync(
        join(runtime, logs[0]!),
        `INFO openab: sign-in token=${secret} key=ghp_${secret.replaceAll('-', '')} home=${homedir()}/x\n`,
      )

      await page
        .getByRole('button', { name: /^Search/ })
        .first()
        .click()
      await page.keyboard.type('User settings')
      await page.getByRole('option', { name: 'User settings' }).first().click()
      await page.getByRole('searchbox', { name: 'Search settings' }).fill('Privacy')
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: 'Save diagnostics' }).click()

      const shown = page.getByText(/nuphos-diagnostics-[^/\\]+\.zip$/)

      await shown.waitFor()
      const zip = (await shown.innerText()).trim()

      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'diagnostics-saved.png') })

      try {
        const names = unzip('-Z1', zip).trim().split('\n').sort()
        const expected = [
          'summary.json',
          ...['users/*/*/openab.log', 'instances/*/users/*/*/openab.log']
            .flatMap((pattern) => globSync(pattern, { cwd: runtime }))
            .map((log) => `logs/${log}`),
        ].sort()

        if (JSON.stringify(names) !== JSON.stringify(expected))
          throw new Error(`The zip holds ${names.join(', ')}, not ${expected.join(', ')}`)

        const summary = JSON.parse(unzip('-p', zip, 'summary.json')) as {
          desktop: { version: string }
          os: { platform: string }
        }

        if (!summary.desktop.version || summary.os.platform !== process.platform)
          throw new Error(`The summary is missing versions: ${JSON.stringify(summary)}`)

        const text = unzip('-p', zip, `logs/${logs[0]!}`)

        if ([secret, secret.replaceAll('-', ''), homedir()].some((value) => text.includes(value)))
          throw new Error('The saved log still holds the planted secret or the home directory')
        if (!text.includes('token=[redacted] key=[redacted_key] home=~/x'))
          throw new Error('The planted line is missing from the saved log')
        console.log(`  diagnostics zip: ${names.join(', ')}`)
      } finally {
        rmSync(zip, { force: true })
        await page.getByRole('button', { name: 'Back to app' }).click()
      }
    },
  },
]
