import { connectorSharingFlow } from './connector-sharing-scenarios.ts'
import { startStack } from './stack.ts'
import { artifacts, stopAll } from './processes.ts'
import { startDesktop } from './desktop.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
let desktop: Awaited<ReturnType<typeof startDesktop>> | undefined
try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  await connectorSharingFlow(stack)
  desktop = await startDesktop(stack.apiUrl)
  const page = desktop.page
  await signInScenarios[1]!.run(page, stack)
  await page.getByRole('button', { name: 'Connectors', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Open SonarQube', exact: true }).waitFor()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${artifacts}/real-catalog.png` })
  await dialog.getByRole('button', { name: 'Manage connections', exact: true }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/real-my-connections.png` })
  await dialog.getByRole('button', { name: 'Shared with the team', exact: true }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/real-shared-connections.png` })
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await dialog.getByRole('button', { name: 'Open GitHub', exact: true }).click()
  await page
    .getByText('Commits, PRs', { exact: false })
    .waitFor({ timeout: 1000 })
    .catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${artifacts}/real-service-detail.png` })
  await page.getByRole('dialog').getByRole('button', { name: 'Close modal', exact: true }).click()
  console.log('OTHER_DIALOG_CANDIDATES', await page.getByRole('button').allTextContents())
  console.log('PASS real Electron app captures')
} finally {
  await desktop?.close()
  await stopAll()
}
