import { BindAccountDialog } from '../BindAccountDialog'
import { BindAsanaDialog } from '../BindAsanaDialog'
import { BindDatabaseDialog } from '../BindDatabaseDialog'
import { BindDiscordDialog } from '../BindDiscordDialog'
import { BindGithubDialog } from '../BindGithubDialog'
import { BindGitlabDialog } from '../BindGitlabDialog'
import { BindGrafanaDialog } from '../BindGrafanaDialog'
import { BindJiraDialog } from '../BindJiraDialog'
import { BindLarkDialog } from '../BindLarkDialog'
import { BindLinearDialog } from '../BindLinearDialog'
import { BindOnpremClusterDialog } from '../BindOnpremClusterDialog'
import { BindPosthogDialog } from '../BindPosthogDialog'
import { BindSentryDialog } from '../BindSentryDialog'
import { BindSlackDialog } from '../BindSlackDialog'
import { BindSonarqubeDialog } from '../BindSonarqubeDialog'

import type { BindMode } from './connector-actions'
import type { BindProvider } from './team-home-bind'

export type FocusedConnector = { provider: 'posthog'; connectorId: string; name: string }

export function TeamHomeBindDialogs({
  teamId,
  onOpenAgentChat,
  onChanged,
  onFocusConnector,
  bindProvider,
  setBindProvider,
  bindGithubOpen,
  setBindGithubOpen,
  bindGitlabOpen,
  setBindGitlabOpen,
  bindLinearOpen,
  setBindLinearOpen,
  bindJiraOpen,
  setBindJiraOpen,
  bindAsanaOpen,
  setBindAsanaOpen,
  bindSentryOpen,
  setBindSentryOpen,
  bindPosthogOpen,
  setBindPosthogOpen,
  bindGrafanaOpen,
  setBindGrafanaOpen,
  bindSonarqubeOpen,
  setBindSonarqubeOpen,
  bindOnpremOpen,
  setBindOnpremOpen,
  bindDatabaseOpen,
  setBindDatabaseOpen,
  bindSlackOpen,
  setBindSlackOpen,
  bindDiscordOpen,
  setBindDiscordOpen,
  bindLarkOpen,
  setBindLarkOpen,
  bindMode = 'install',
}: {
  teamId: string
  onOpenAgentChat: (prompt: string) => void
  onChanged: () => void
  onFocusConnector?: (detail: FocusedConnector) => void
  bindProvider: BindProvider | null
  setBindProvider: (provider: BindProvider | null) => void
  bindGithubOpen: boolean
  setBindGithubOpen: (open: boolean) => void
  bindGitlabOpen: boolean
  setBindGitlabOpen: (open: boolean) => void
  bindLinearOpen: boolean
  setBindLinearOpen: (open: boolean) => void
  bindJiraOpen: boolean
  setBindJiraOpen: (open: boolean) => void
  bindAsanaOpen: boolean
  setBindAsanaOpen: (open: boolean) => void
  bindSentryOpen: boolean
  setBindSentryOpen: (open: boolean) => void
  bindPosthogOpen: boolean
  setBindPosthogOpen: (open: boolean) => void
  bindGrafanaOpen: boolean
  setBindGrafanaOpen: (open: boolean) => void
  bindSonarqubeOpen: boolean
  setBindSonarqubeOpen: (open: boolean) => void
  bindOnpremOpen: boolean
  setBindOnpremOpen: (open: boolean) => void
  bindDatabaseOpen: boolean
  setBindDatabaseOpen: (open: boolean) => void
  bindSlackOpen: boolean
  setBindSlackOpen: (open: boolean) => void
  bindDiscordOpen: boolean
  setBindDiscordOpen: (open: boolean) => void
  bindLarkOpen: boolean
  setBindLarkOpen: (open: boolean) => void
  bindMode?: BindMode
}) {
  return (
    <>
      <BindAccountDialog
        open={Boolean(bindProvider)}
        teamId={teamId}
        initialProvider={bindProvider ?? 'aws'}
        onOpenAgentChat={onOpenAgentChat}
        onClose={() => setBindProvider(null)}
        onBound={() => {
          setBindProvider(null)
          onChanged()
        }}
      />
      {bindGithubOpen && (
        <BindGithubDialog
          open
          teamId={teamId}
          onClose={() => setBindGithubOpen(false)}
          onBound={() => {
            setBindGithubOpen(false)
            onChanged()
          }}
        />
      )}
      {bindGitlabOpen && (
        <BindGitlabDialog
          open
          teamId={teamId}
          onClose={() => setBindGitlabOpen(false)}
          onBound={() => {
            setBindGitlabOpen(false)
            onChanged()
          }}
        />
      )}
      {bindLinearOpen && (
        <BindLinearDialog
          open
          teamId={teamId}
          onClose={() => setBindLinearOpen(false)}
          onBound={() => {
            setBindLinearOpen(false)
            onChanged()
          }}
        />
      )}
      {/* Always mounted so the dialog's close effect can observe open=false and
          tear down a pending OAuth grant (otherwise Cancel unmounts it before
          atlasCancelJiraOAuth runs, leaving a grant that can still complete). */}
      <BindJiraDialog
        open={bindJiraOpen}
        teamId={teamId}
        onClose={() => setBindJiraOpen(false)}
        onBound={() => {
          setBindJiraOpen(false)
          onChanged()
        }}
      />
      {/* Always mounted so the dialog's close effect can tear down a pending
          OAuth grant on Cancel — same rationale as BindJiraDialog above. */}
      <BindAsanaDialog
        open={bindAsanaOpen}
        teamId={teamId}
        onClose={() => setBindAsanaOpen(false)}
        onBound={() => {
          setBindAsanaOpen(false)
          onChanged()
        }}
      />
      <BindSentryDialog
        open={bindSentryOpen}
        teamId={teamId}
        onClose={() => setBindSentryOpen(false)}
        onBound={() => {
          setBindSentryOpen(false)
          onChanged()
        }}
      />

      {bindGrafanaOpen && (
        <BindGrafanaDialog
          teamId={teamId}
          onClose={() => setBindGrafanaOpen(false)}
          onBound={() => {
            setBindGrafanaOpen(false)
            onChanged()
          }}
        />
      )}

      {bindOnpremOpen && (
        <BindOnpremClusterDialog
          teamId={teamId}
          onClose={() => setBindOnpremOpen(false)}
          onBound={() => {
            setBindOnpremOpen(false)
            onChanged()
          }}
        />
      )}

      {bindPosthogOpen && (
        <BindPosthogDialog
          teamId={teamId}
          onClose={() => setBindPosthogOpen(false)}
          onBound={(bindingId) => {
            setBindPosthogOpen(false)
            onChanged()
            if (bindingId) {
              onFocusConnector?.({ provider: 'posthog', connectorId: bindingId, name: 'PostHog' })
            }
          }}
        />
      )}

      {bindSonarqubeOpen && (
        <BindSonarqubeDialog
          teamId={teamId}
          onClose={() => setBindSonarqubeOpen(false)}
          onBound={() => {
            setBindSonarqubeOpen(false)
            onChanged()
          }}
        />
      )}
      <BindDatabaseDialog
        open={bindDatabaseOpen}
        teamId={teamId}
        onClose={() => setBindDatabaseOpen(false)}
        onBound={() => {
          setBindDatabaseOpen(false)
          onChanged()
          window.dispatchEvent(new Event('nuphos:databases-changed'))
        }}
      />

      <BindSlackDialog
        open={bindSlackOpen}
        teamId={teamId}
        mode={bindMode}
        onClose={() => setBindSlackOpen(false)}
        onBound={() => {
          setBindSlackOpen(false)
          onChanged()
        }}
      />

      <BindDiscordDialog
        open={bindDiscordOpen}
        teamId={teamId}
        onClose={() => setBindDiscordOpen(false)}
        onBound={() => {
          setBindDiscordOpen(false)
          onChanged()
        }}
      />

      <BindLarkDialog
        open={bindLarkOpen}
        teamId={teamId}
        mode={bindMode}
        onClose={() => {
          // Close + re-sync only after the user finishes the wizard. Closing in
          // onBound (the moment credentials save) skips the final "webhook &
          // events" step where the user copies the Request URL — the bot never
          // works without it.
          setBindLarkOpen(false)
          onChanged()
        }}
        onBound={() => {}}
      />
    </>
  )
}
