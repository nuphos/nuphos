import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const SOLID_IMPORT = /['"]@fortawesome\/free-solid-svg-icons['"]/

// Existing callers at the start of #3006; area guards retire each group permanently.
export const legacySolidIconFiles = new Set([
  'app/nav/cloudAccountNavItems.tsx',
  'app/nav/providerNavItems.tsx',
  'app/scopeContent/awsObservabilityPages.tsx',
  'app/scopeContent/cloudflarePages.tsx',
  'app/scopeContent/gcpPages.tsx',
  'app/scopeContent/integrationPages.tsx',
  'app/workspace/WorkspacePageToolbar.tsx',
  'app/workspace/breadcrumb/navPickerCrumbs.tsx',
  'app/workspace/tabs/WorkspaceTabItem.tsx',
  'app/workspace/tabs/WorkspaceTabs.tsx',
  'architecture/canvas/Inspector.tsx',
  'architecture/canvas/Toolbar.tsx',
  'components/BulkActionBar.tsx',
  'components/CloudLogo.tsx',
  'components/ConnectorWizard.tsx',
  'components/PodTerminalView.tsx',
  'components/agent/panel/composerAttachments.tsx',
  'components/agent/panel/composerMenus.tsx',
  'components/agent/panel/messageInline.tsx',
  'components/sidebar/sections-cloud.tsx',
  'components/sidebar/sections-services.tsx',
  'components/sidebar/view.tsx',
  'components/ui/ToastProvider.tsx',
  'views/ArchitectureView.tsx',
  'views/AuditLogView.tsx',
  'views/BindAsanaDialog.tsx',
  'views/BindDiscordDialog.tsx',
  'views/BindJiraDialog.tsx',
  'views/BindLarkDialog.tsx',
  'views/BindLinearDialog.tsx',
  'views/BindPlaudDialog.tsx',
  'views/BindSentryDialog.tsx',
  'views/BindSlackDialog.tsx',
  'views/BindTrelloDialog.tsx',
  'views/CreateOrJoinTeamView.tsx',
  'views/DaemonSetsView.tsx',
  'views/DeploymentsView.tsx',
  'views/LarkSettingsView.tsx',
  'views/LoginSocialButtons.tsx',
  'views/MonitoringView.tsx',
  'views/PodsView.tsx',
  'views/SlackSettingsView.tsx',
  'views/StatefulSetsView.tsx',
  'views/bind-account/cloudflare-scopes.ts',
  'views/bind-account/cloudflare.tsx',
  'views/bind-account/shared.tsx',
  'views/bind-lark/controls.tsx',
  'views/cloud/cloudflare-d1-detail.tsx',
  'views/cloud/cloudflare-d1.tsx',
  'views/cloud/cloudflare-kv-detail.tsx',
  'views/cloud/cloudflare-kv.tsx',
  'views/cloud/cloudflare-pages-detail.tsx',
  'views/cloud/cloudflare-pages-sections.tsx',
  'views/cloud/cloudflare-pages.tsx',
  'views/cloud/cloudflare-r2-detail.tsx',
  'views/cloud/cloudflare-r2-dialogs.tsx',
  'views/cloud/cloudflare-r2-objects-table.tsx',
  'views/cloud/cloudflare-r2.tsx',
  'views/cloud/cloudflare-worker-detail.tsx',
  'views/cloud/lambda-metrics.tsx',
  'views/cloud/log-group-events.tsx',
  'views/cloud/s3-object-preview.tsx',
  'views/detail/terminal-tabs.tsx',
  'views/gitlab/GitlabBindingsList.tsx',
  'views/k8s-resources/CronJobsView.tsx',
  'views/lark-settings/LarkLinkedAccountsCard.tsx',
  'views/lark-settings/LarkPairCard.tsx',
  'views/linode/LkeClustersView.tsx',
  'views/messaging-settings/ConnectionActions.tsx',
  'views/monitoring/WatchDestinationDialog.tsx',
  'views/monitoring/parts.tsx',
  'views/monitoring/rowActions.ts',
  'views/settings/AllowedEmailDomainCard.tsx',
  'views/settings/DeviceActivityList.tsx',
  'views/settings/GeneralSection.tsx',
  'views/settings/InstructionCard.tsx',
  'views/settings/TeamPageSections.tsx',
  'views/settings/personalSections.tsx',
  'views/slack-settings/LinkChannelPanel.tsx',
])

export function solidIconFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return solidIconFiles(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []

    return SOLID_IMPORT.test(readFileSync(path, 'utf8'))
      ? [relative(SRC, path).replaceAll('\\', '/')]
      : []
  })
}

export function iconMigrationArea(path: string) {
  if (
    /^(components\/sidebar\/|app\/(nav|scopeContent|workspace)\/)/.test(path) ||
    path === 'components/CloudLogo.tsx'
  )
    return 'navigation'
  if (path.startsWith('components/agent/') || path === 'components/ui/ToastProvider.tsx')
    return 'conversation'
  if (
    /^views\/(settings|bind-account|bind-lark|lark-settings|slack-settings|messaging-settings|gitlab)\//.test(
      path,
    ) ||
    path.startsWith('views/Bind') ||
    [
      'views/SlackSettingsView.tsx',
      'views/LarkSettingsView.tsx',
      'views/LoginSocialButtons.tsx',
      'views/CreateOrJoinTeamView.tsx',
      'components/ConnectorWizard.tsx',
    ].includes(path)
  )
    return 'settings'

  return 'resources'
}
