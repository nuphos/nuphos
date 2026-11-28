import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { workbookBytes } from '../../apps/desktop/test-fixtures/xlsx-preview/workbook.mjs'

import { rest } from './leave-helpers.ts'
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'

export const xlsxPreviewScenarios: Scenario[] = [
  {
    name: 'a real XLSX transfer opens in the dock and switches worksheets',
    run: async (page, stack) => {
      const api = rest(stack, stack.token)
      const sessionId = randomUUID()
      const title = 'XLSX preview review'

      await api('PUT', `/agent/conversations/${sessionId}/transcript`, {
        teamId: stack.teamId,
        title,
        agentRuntime: 'claude-code',
        import: true,
        messages: [
          {
            id: randomUUID(),
            role: 'user',
            parts: [{ type: 'text', text: 'Create a fictional sample workbook.' }],
          },
          {
            id: randomUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: 'Here is the fictional sample workbook.' }],
          },
        ],
      })
      const transfers = `/agent-sessions/${sessionId}/teams/${stack.teamId}/file-transfers`
      const bytes = workbookBytes()
      const group = await api<{ groupId: string; files: { uploadUrl: string }[] }>(
        'POST',
        transfers,
        {
          direction: 'download',
          files: [
            {
              fileName: 'sample.xlsx',
              size: bytes.length,
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          ],
        },
      )
      const uploaded = await fetch(group.files[0]!.uploadUrl, { method: 'PUT', body: bytes })

      assert.equal(uploaded.ok, true)
      await api('POST', `${transfers}/${group.groupId}/finalize`, {})
      const resolved = await api<{ files: { downloadUrl: string }[] }>(
        'GET',
        `${transfers}/${group.groupId}/download`,
      )
      const stored = await fetch(resolved.files[0]!.downloadUrl)

      assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes)
      await page.reload()
      await page.getByRole('tab', { name: 'Tasks', exact: true }).click()
      await page.getByText(title, { exact: true }).first().click()
      await page.getByRole('button', { name: 'Preview sample.xlsx', exact: true }).waitFor()
      await page.evaluate(() => {
        localStorage.setItem('theme', 'light')
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${artifacts}/xlsx-attachment-light.png` })
      await page.getByRole('button', { name: 'Preview sample.xlsx', exact: true }).click()
      await page.getByRole('cell', { name: '120', exact: true }).waitFor()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${artifacts}/xlsx-overview-light.png` })
      await page.getByRole('combobox', { name: 'Worksheet' }).click()
      await page.getByRole('option', { name: 'Details', exact: true }).click()
      await page
        .getByRole('cell', { name: '<script>globalThis.xlsxExecuted=true</script>', exact: true })
        .waitFor()
      assert.equal(
        await page.evaluate(() => (window as unknown as { xlsxExecuted?: boolean }).xlsxExecuted),
        undefined,
      )
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${artifacts}/xlsx-details-light.png` })
      await page.getByRole('combobox', { name: 'Worksheet' }).click()
      await page.getByRole('option', { name: 'Empty', exact: true }).click()
      await page.getByText('No data', { exact: true }).waitFor()
      await page.screenshot({ path: `${artifacts}/xlsx-empty-light.png` })
      console.log(
        'PASS: real transfer PUT/finalize/GET, Electron attachment card, dock, worksheet switching',
      )
    },
  },
]
