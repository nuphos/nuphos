import { nestedBotsCheck } from './nested-bots-check.ts'
// `bun run e2e`: the Desktop app against a real backend, database and OpenAB, with a
// deterministic agent in place of a model. Each scenario is a flow a person takes.
import { rmSync } from 'node:fs'

import { accessScenarios } from './access-scenarios.ts'
import { agentEvents } from './agent-log.ts'
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
import { mcpFileScenarios } from './mcp-file-scenarios.ts'
import { connectorScenarios } from './connector-scenarios.ts'
import { dashboardScenarios } from './dashboard-scenarios.ts'
import { dashboardUiScenarios } from './dashboard-ui-scenarios.ts'
import { desktopScreenScenarios } from './desktop-screen-scenarios.ts'
import { installScenarios } from './install-scenarios.ts'
import { leaveChatScenarios } from './leave-chat-scenarios.ts'
import { leaveTaskScenarios } from './leave-task-scenarios.ts'
import { linkChipScenarios } from './link-chip-scenarios.ts'
import { longTranscriptScenarios } from './long-transcript-scenarios.ts'
import { mcpDefaultsScenarios } from './mcp-defaults-scenarios.ts'
import { mcpCredentialDefaultsScenarios } from './mcp-credential-defaults-scenarios.ts'
import { mcpScenarios } from './mcp-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { fallbackScenarios } from './fallback-scenarios.ts'
import { formScenario } from './form-scenario.ts'
import { memberStreamScenarios } from './member-stream-scenarios.ts'
import { mentionScenarios } from './mention-scenarios.ts'
import { offlineScenarios } from './offline-scenarios.ts'
import { outdatedTurnScenarios } from './outdated-turn-scenarios.ts'
import { personalCredentialScenarios } from './personal-credential-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { providerUnreachableScenarios } from './provider-unreachable-scenarios.ts'
import { proxyScenarios } from './proxy-scenarios.ts'
import { questionScenarios } from './question-scenarios.ts'
import { replyFileScenarios } from './reply-file-scenarios.ts'
import { runtimeScenarios } from './runtime-scenarios.ts'
import { settingsHistoryScenarios } from './settings-history-scenarios.ts'
import { sidebarPageScenarios } from './sidebar-page-scenarios.ts'
import { botFoldScenarios, sidebarScenarios } from './sidebar-scenarios.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { skillScenarios } from './skill-scenarios.ts'
import { splitPaneScenarios } from './split-pane-scenarios.ts'
import { sessionResourceScenarios } from './session-resource-scenarios.ts'
import { startStack } from './stack.ts'
import { stepUpScenarios } from './step-up-scenarios.ts'
import { teammateBotScenarios } from './teammate-bot-scenarios.ts'
import { terminalScenarios } from './terminal-scenarios.ts'
import { threadModeScenario, threadScenarios } from './thread-scenarios.ts'
import { triggerHistoryScenarios } from './trigger-history-scenarios.ts'
import { triggerScenarios } from './trigger-scenarios.ts'
import { tunnelScenarios } from './tunnel-scenarios.ts'
import { turnScenarios } from './turn-scenarios.ts'
import { voiceScenarios } from './voice-scenarios.ts'
import { newTask, send } from './ui.ts'
import { usageScenarios } from './usage-scenarios.ts'

import type { Desktop } from './desktop.ts'
import type { Scenario } from './ui.ts'

const scenarios: Scenario[] = [
  ...signInScenarios,
  ...nestedBotsCheck,
]

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  for (const [index, scenario] of [...scenarios, formScenario].entries()) {
    await desktop.traceNextScenario()
    const from = backendLines()

    await scenario.run(desktop.page, stack)
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
