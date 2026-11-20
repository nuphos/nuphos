import { connectorSharingFlow } from './connector-sharing-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'

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
  await dialog.getByRole('button', { name: /^(Open|Add) GitHub$/ }).click()
  await page
    .getByText('Commits, PRs', { exact: false })
    .waitFor({ timeout: 1000 })
    .catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${artifacts}/real-service-detail.png` })
  await page.getByRole('dialog').getByRole('button', { name: 'Close modal', exact: true }).click()
  await page.getByRole('button', { name: 'New Bot', exact: true }).first().click()
  await page.getByRole('textbox', { name: 'Bot name' }).waitFor()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${artifacts}/real-other-modal.png` })
  console.log('PASS real Electron app captures')
} finally {
  await desktop?.close()
  await stopAll()
}
