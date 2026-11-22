// `bun run e2e`: the Desktop app against a real backend, database and OpenAB, with a
// deterministic agent in place of a model. Each scenario is a flow a person takes.
import { rmSync } from 'node:fs'

import { accessScenarios } from './access-scenarios.ts'
import { agentEvents } from './agent-log.ts'
import { archivePopoverScenarios } from './archive-popover-scenarios.ts'
import { archiveSharedTaskScenarios } from './archive-shared-task-scenarios.ts'
import { agentWordScenarios } from './agent-word-scenarios.ts'
import { approvalFeedbackScenarios } from './approval-feedback-scenarios.ts'
import { avatarBackgroundScenarios } from './avatar-background-scenarios.ts'
import { backendFailures, backendLines } from './backend-log.ts'
import { botTriggerRowScenarios } from './bot-trigger-row-scenarios.ts'
import { botTurnScenarios } from './bot-turn-scenarios.ts'
import { botUnreadScenarios } from './bot-unread-scenarios.ts'
import { botWorkingDotsScenarios } from './bot-working-dots-scenarios.ts'
import { checkDecisionOutline, checkOutgoingChip } from './chat-presentation.ts'
import { cliBrowserScenarios } from './cli-browser-scenarios.ts'
import { channelScenarios } from './channel-scenarios.ts'
import { channelAwayScenarios } from './channel-away-scenarios.ts'
import { channelRestartScenarios } from './channel-restart-scenarios.ts'
import { commandScenarios } from './command-scenarios.ts'
import { computerScenarios } from './computer-scenarios.ts'
import { computersEntryScenarios } from './computers-entry-scenarios.ts'
import { computerUpdateScenarios } from './computer-update-scenarios.ts'
import { customProviderScenarios } from './custom-provider-scenarios.ts'
import { mcpFileScenarios } from './mcp-file-scenarios.ts'
import { mcpArchiveScenarios } from './mcp-archive-scenarios.ts'
import { connectorScenarios } from './connector-scenarios.ts'
import { dashboardScenarios } from './dashboard-scenarios.ts'
import { dashboardUiScenarios } from './dashboard-ui-scenarios.ts'
import { teamSwitchTasksScenarios } from './team-switch-tasks-scenarios.ts'
import { desktopScreenScenarios } from './desktop-screen-scenarios.ts'
import { installScenarios } from './install-scenarios.ts'
import { leaveChatScenarios } from './leave-chat-scenarios.ts'
import { newGroupChatScenarios } from './new-group-chat-scenarios.ts'
import { leaveTaskScenarios } from './leave-task-scenarios.ts'
import { linkChipScenarios } from './link-chip-scenarios.ts'
import { longTranscriptScenarios } from './long-transcript-scenarios.ts'
import { mcpDefaultsScenarios } from './mcp-defaults-scenarios.ts'
import { mcpCredentialDefaultsScenarios } from './mcp-credential-defaults-scenarios.ts'
import { mcpScenarios } from './mcp-scenarios.ts'
import { modelRecoveryScenarios } from './model-recovery-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { fallbackScenarios } from './fallback-scenarios.ts'
import { formScenario } from './form-scenario.ts'
import { mcpNotificationScenarios } from './mcp-notification-scenarios.ts'
import { memberStreamScenarios } from './member-stream-scenarios.ts'
import { mentionScenarios } from './mention-scenarios.ts'
import { newTaskGreetingScenario } from './new-task-greeting-scenario.ts'
import { offlineScenarios } from './offline-scenarios.ts'
import { outdatedTurnScenarios } from './outdated-turn-scenarios.ts'
import { personalAccountScenarios } from './personal-accounts-scenarios.ts'
import { personalConnectScenarios } from './personal-connect-scenarios.ts'
import { personalCredentialScenarios } from './personal-credential-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { providerUnreachableScenarios } from './provider-unreachable-scenarios.ts'
import { proxyScenarios } from './proxy-scenarios.ts'
import { questionScenarios } from './question-scenarios.ts'
import { replyFileScenarios } from './reply-file-scenarios.ts'
import { replyDiskScenario } from './reply-disk-scenario.ts'
import { runEndTraceScenario } from './run-end-trace-scenario.ts'
import { runtimeScenarios } from './runtime-scenarios.ts'
import { settingsHistoryScenarios } from './settings-history-scenarios.ts'
import { sidebarPageScenarios } from './sidebar-page-scenarios.ts'
import { botFoldScenarios, sidebarScenarios } from './sidebar-scenarios.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { skillScenarios } from './skill-scenarios.ts'
import { splitPaneScenarios } from './split-pane-scenarios.ts'
import { sessionResourceScenarios } from './session-resource-scenarios.ts'
import { sessionRevokedScenario } from './session-revoked-scenario.ts'
import { startStack } from './stack.ts'
import { stepUpScenarios } from './step-up-scenarios.ts'
import { twoFactorResumeScenarios } from './two-factor-resume-scenarios.ts'
import { teammateBotScenarios } from './teammate-bot-scenarios.ts'
import { terminalScenarios } from './terminal-scenarios.ts'
import { threadModeScenario, threadScenarios } from './thread-scenarios.ts'
import { triggerHistoryScenarios } from './trigger-history-scenarios.ts'
import { instructionScenarios } from './instruction-scenarios.ts'
import { triggerScenarios } from './trigger-scenarios.ts'
import { usageQueueScenarios } from './usage-queue-scenarios.ts'
import { triggerLinkScenarios } from './trigger-link-scenarios.ts'
import { tunnelScenarios } from './tunnel-scenarios.ts'
import { turnScenarios } from './turn-scenarios.ts'
import { voiceScenarios } from './voice-scenarios.ts'
import { webhookScenarios } from './webhook-scenarios.ts'
import { newTask, send } from './ui.ts'
import { usageScenarios } from './usage-scenarios.ts'
import { webhookSecretScenarios } from './webhook-secret-scenarios.ts'

import type { Desktop } from './desktop.ts'
import type { Scenario } from './ui.ts'

const scenarios: Scenario[] = [
  ...signInScenarios,
  ...sidebarScenarios,
  {
    // The flow #3012 was reported in: the sidebar is on Bots, the page a new team opens on.
    // The connector's CLI (`aws`) has to be on the PATH for the dialog to offer the agent.
    name: 'set up a cloud connector with the agent from the Bots page, and the setup turn runs',
    run: async (page, stack) => {
      await page.getByRole('button', { name: 'Connectors', exact: true }).click()
      await page.getByRole('button', { name: 'Add AWS' }).click()
      await page.getByRole('button', { name: /Set up in a task/ }).click()
      await page.getByText('ACK E2E_DELIVERY:missing').waitFor()
      await until('the setup prompt to reach the agent', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:missing'),
      )
      // Back where a new team starts, for the scenarios that follow.
      await page.getByRole('tab', { name: 'Bots' }).click()
    },
  },
  {
    // The flow #2412 was reported in: a Bot's credential question with choices, answered in its chat.
    name: 'create a Bot, talk to it in its chat, and answer its question there',
    run: async (page, stack) => {
      await page.getByRole('button', { name: 'New Bot', exact: true }).click()
      await page.getByRole('textbox', { name: 'Bot name' }).fill('E2E Bot')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      // No user prompt precedes this reply: creating/opening the Bot starts its introduction.
      // The fixture's missing marker proves the turn did not originate from a delivery prompt.
      await page.getByText('POSTED E2E_DELIVERY:missing', { exact: true }).waitFor()
      await until('the unprompted Bot introduction to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:missing'),
      )
      await page.screenshot({ path: `${artifacts}/bot-first-reply.png` })
      await send(
        page,
        'Review https://github.com/nuphos/nuphos/issues/1 E2E_ASK_CREDENTIAL E2E_DELIVERY:bot',
      )
      await page.getByText('POSTED E2E_DELIVERY:bot', { exact: true }).waitFor()
      await checkDecisionOutline(page)
      await checkOutgoingChip(page)
      await page.screenshot({ path: `${artifacts}/bot-question-outline.png` })
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
      await until('the answer in the Bot chat to reach the Bot', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:answered'),
      )
    },
  },
  { name: 'a reply and low disk warning remain visible together', run: replyDiskScenario },
  ...botUnreadScenarios,
  ...channelScenarios,
  ...botWorkingDotsScenarios,
  ...channelAwayScenarios,
  ...channelRestartScenarios,
  ...mcpDefaultsScenarios,
  ...mcpCredentialDefaultsScenarios,
  ...teammateBotScenarios,
  ...leaveTaskScenarios,
  ...archiveSharedTaskScenarios,
  ...archivePopoverScenarios,
  ...leaveChatScenarios,
  ...newGroupChatScenarios,
  ...avatarBackgroundScenarios,
  {
    name: 'start a Task, send a message and read the reply',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Say hello E2E_DELIVERY:first')
      await page.getByText('ACK E2E_DELIVERY:first').waitFor()
    },
  },
  ...linkChipScenarios,
  ...voiceScenarios,
  ...personalCredentialScenarios,
  ...personalConnectScenarios,
  ...personalAccountScenarios,
  ...mentionScenarios,
  ...sessionResourceScenarios,
  // Before the Stop scenarios: a Stop while its turn was being saved was lost (#3403).
  ...longTranscriptScenarios,
  ...replyFileScenarios,
  ...agentWordScenarios,
  ...turnScenarios,
  ...questionScenarios,
  ...triggerScenarios,
  ...instructionScenarios,
  ...botTriggerRowScenarios,
  ...webhookSecretScenarios,
  ...triggerHistoryScenarios,
  ...usageScenarios,
  ...connectorScenarios,
  // Turns two-factor authentication on for this account, and off again.
  ...stepUpScenarios,
  ...twoFactorResumeScenarios,
  ...accessScenarios,
  ...runtimeScenarios,
  // After runtimeScenarios: it runs a Task on the second agent, which one of those needs unused.
  ...usageQueueScenarios,
  ...customProviderScenarios,
  ...botTurnScenarios,
  ...providerUnreachableScenarios,
  // It needs the Bot the access scenarios create.
  ...computersEntryScenarios,
  // It removes a member from the team.
  ...dashboardScenarios,
  // Right after the one above: it opens the dashboards that scenario leaves behind.
  ...dashboardUiScenarios,
  // Right after the one above, which leaves the app in another team: it switches back.
  ...teamSwitchTasksScenarios,
  // Right after the one above, back on a Task that 404s: its new Task leaves it.
  // It needs the Bot the access scenarios create. It leaves the window split, then closes a pane.
  ...splitPaneScenarios,
  // Makes its own Task and Bot, so it can sit here while the main window is still in use.
  ...triggerLinkScenarios,
  // After every turn of this half: it reads what the backend logged for them.
  runEndTraceScenario,
]

// CI runs the two halves on two runners (#4471); the second signs in again on its own stack.
// A scenario that needs something created earlier in the run stays in its creator's half.
const later: Scenario[] = [
  ...computerScenarios,
  ...computerUpdateScenarios,
  ...mcpFileScenarios,
  ...mcpArchiveScenarios,
  ...desktopScreenScenarios,
  ...commandScenarios,
  ...threadScenarios,
  ...settingsHistoryScenarios,
  newTaskGreetingScenario,
  ...offlineScenarios,
  ...mcpNotificationScenarios,
  ...webhookScenarios,
  ...outdatedTurnScenarios,
  ...mcpScenarios,
  ...skillScenarios,
  ...approvalFeedbackScenarios,
  threadModeScenario,
  ...botFoldScenarios,
  ...sidebarPageScenarios,
  ...fallbackScenarios,
  ...memberStreamScenarios,
  // A computer of its own, which it stops and forgets again.
  ...modelRecoveryScenarios,
  // A second computer of its own, which it stops again.
  ...tunnelScenarios,
  // Another app of its own per proxy, reaching the backend only through it, which it quits again.
  ...proxyScenarios,
  ...terminalScenarios,
  ...cliBrowserScenarios,
  // Last: this computer has Claude Code from then on.
  ...installScenarios,
  formScenario,
  // Last of all: it signs the app out.
  sessionRevokedScenario,
]
const shard = process.env.E2E_SHARD
const selected =
  shard === '1'
    ? scenarios
    : shard === '2'
      ? [...signInScenarios, ...later]
      : [...scenarios, ...later]

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  for (const [index, scenario] of selected.entries()) {
    await desktop.traceNextScenario()
    const from = backendLines()

    await scenario.run(desktop.page, stack, desktop)
    const failures = backendFailures(from, scenario.expected)

    await desktop.page.screenshot({ path: `${artifacts}/${String(index + 1)}.png` })
    if (failures.length > 0)
      throw new Error(`"${scenario.name}" made the backend fail:\n${failures.join('\n')}`)
    console.log(`PASS ${scenario.name}`)
  }
  console.log('PASS Desktop end-to-end (real backend, MongoDB and OpenAB; fixture agent)')
} catch (error) {
  failed = true
  console.error(error)
  console.error(`FAIL: logs, the last screenshot and trace.zip are in ${artifacts}`)
} finally {
  await desktop?.close(failed)
  await stopAll()
  if (desktop) rmSync(desktop.profile, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
