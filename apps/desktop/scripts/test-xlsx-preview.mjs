// Start: pnpm exec vite --config vite.xlsx-preview.config.mjs
// Run: CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/test-xlsx-preview.mjs
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const evidence = process.env.XLSX_EVIDENCE_DIR || '/tmp/nuphos-xlsx-preview-evidence'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
})
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 850 },
    deviceScaleFactor: 2,
  })
  const errors = []
  const external = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue()
    external.push(route.request().url())
    return route.abort()
  })
  await page.goto('http://127.0.0.1:52387/')
  const card = page.getByTestId('card')
  const dock = page.getByTestId('dock')
  await card.getByRole('button', { name: 'Preview sample.xlsx', exact: true }).press('Enter')
  await dock.getByRole('combobox', { name: 'Worksheet' }).waitFor()
  await dock.getByRole('cell', { name: '120', exact: true }).waitFor()
  assert.ok((await dock.textContent()).includes('=1+2'), 'uncached formula stays text')
  await dock.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Details', exact: true }).waitFor()
  assert.equal(await page.getByRole('option').count(), 3)
  await page.getByRole('option', { name: 'Details', exact: true }).click()
  await dock
    .getByRole('cell', { name: '<script>globalThis.xlsxExecuted=true</script>', exact: true })
    .waitFor()
  assert.equal(await page.evaluate(() => window.xlsxExecuted), undefined)
  assert.equal(await dock.locator('script,a').count(), 0)
  assert.ok((await dock.locator('tbody tr').count()) < 100, 'rows are virtualized')
  await dock.locator('[aria-label="Details"]').evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await dock.getByRole('cell', { name: 'Detail 300', exact: true }).waitFor()
  await dock.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Empty', exact: true }).click()
  await dock.getByText('No data', { exact: true }).waitFor()
  await dock.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Overview', exact: true }).click()
  const before = await page.evaluate(
    () => window.fixtureCalls.filter((call) => call[0] === 'read').length,
  )
  await card.getByRole('button', { name: 'Download', exact: true }).first().click()
  await dock.getByRole('button', { name: 'Download', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.fixtureCalls.filter((call) => call[0] === 'download').length),
    2,
  )
  assert.equal(
    await page.evaluate(() => window.fixtureCalls.filter((call) => call[0] === 'read').length),
    before,
    'download does not reopen preview',
  )
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.className = theme), theme)
    await page.screenshot({ path: `${evidence}/${theme}.png`, fullPage: true })
  }
  await card.getByRole('button', { name: 'Preview broken.xlsx', exact: true }).click()
  await dock.getByText('Preview unavailable', { exact: false }).waitFor()
  assert.ok(await dock.getByRole('button', { name: 'Download', exact: true }).isEnabled())
  await card.getByRole('button', { name: 'Preview large.xlsx', exact: true }).click()
  await dock.getByText('Preview unavailable', { exact: false }).waitFor()
  assert.equal(
    await page.evaluate(
      () =>
        window.fixtureCalls.filter((call) => call[0] === 'read' && call[1].fileId === '4').length,
    ),
    0,
  )
  await card.getByRole('button', { name: 'Show all 7 files' }).click()
  assert.equal(await card.getByRole('button', { name: 'Preview unknown.bin' }).count(), 0)
  await card.getByRole('button', { name: 'Preview mime-only', exact: true }).click()
  await dock.getByRole('combobox', { name: 'Worksheet' }).waitFor()
  for (const [file, expected] of [['report.md', 'Existing Markdown']]) {
    await card.getByRole('button', { name: `Preview ${file}`, exact: true }).click()
    await dock.getByText(expected, { exact: true }).waitFor()
  }
  assert.equal(await card.getByRole('button', { name: 'Preview notes.txt' }).count(), 0)
  assert.ok(
    await page.evaluate(() =>
      window.fixtureCalls
        .filter((call) => call[0] === 'read')
        .every(
          (call) => call[1].channelId === 'fixture-channel' && call[1].maxBytes === 5 * 1024 * 1024,
        ),
    ),
  )
  assert.deepEqual(external, [], 'no spreadsheet content causes external requests')
  assert.deepEqual(errors, [])
  console.log(
    'PASS: real attachment click → bounded Worker → XLSX sheets, switch/scroll/empty, cached and literal formulas, no script/external access, separate downloads, corrupt/large/unknown fallbacks, MIME and existing Markdown preview and TXT download-only regression',
  )
} finally {
  await browser.close()
}
