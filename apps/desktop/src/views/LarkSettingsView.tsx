import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'

import { api } from '../api'
import { WizardConsoleLink, WizardCopyableValue } from '../components/ConnectorWizard'
import { AppAlertDialog } from '../components/ui/alert-dialog'
import { Switch } from '../components/ui/Switch'
import { toast } from '../components/ui/toast'

import { LARK_SUBSCRIBE_EVENTS, larkAppPageUrl } from './bind-lark/console'
import { BindLarkDialog } from './BindLarkDialog'
import { ConnectionActions } from './messaging-settings/ConnectionActions'
import { LarkLinkedAccountsCard } from './lark-settings/LarkLinkedAccountsCard'
import { LarkPairCard } from './lark-settings/LarkPairCard'
import { useLarkSettings } from './lark-settings/useLarkSettings'

export function LarkSettingsView({
  teamId,
  currentUserId,
  refreshKey,
  onChanged,
}: {
  teamId: string | undefined
  currentUserId: string
  // Bumped by the breadcrumb refresh button (via the tab's refreshKey); re-runs load().
  refreshKey?: number
  /** Invoked after a reconfigure/disconnect so the parent's connector list re-syncs. */
  onChanged?: () => void
}) {
  const [reconfigureOpen, setReconfigureOpen] = useState(false)
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false)
  const {
    installation,
    availableChats,
    userMappings,
    status,
    loading,
    busyKey,
    webhookUrl,
    webhookCopied,
    pairCode,
    pairGenerating,
    pairCopied,
    canManage,
    memberById,
    toggleChat,
    deleteUser,
    copyWebhook,
    generatePairCode,
    copyPairCode,
    load,
  } = useLarkSettings(teamId, currentUserId, refreshKey)

  if (!teamId) {
    return <div className="text-[13px] text-tertiary">No workspace selected.</div>
  }

  const installed = !!installation || status?.installed === true
  const consoleDomain = installation?.domain ?? status?.domain
  const consoleAppId = installation?.appId ?? status?.appId

  async function disconnect() {
    if (!teamId) return
    try {
      await api.atlasDisconnectLark(teamId)
    } catch (err) {
      toast.apiError('Could not disconnect Lark', err)

      return
    }
    toast.success('Lark disconnected')
    await load()
    onChanged?.()
  }

  return (
    <div>
      <BindLarkDialog
        open={reconfigureOpen}
        teamId={teamId}
        mode="reinstall"
        onClose={() => {
          setReconfigureOpen(false)
          void load()
          onChanged?.()
        }}
        onBound={() => undefined}
      />
      <AppAlertDialog
        open={confirmDisconnectOpen}
        title="Disconnect Lark"
        description={`Disconnect ${installation?.tenantName ?? 'this Lark app'} from Nuphos? The stored app credentials are removed and the bot stops responding until you connect again.`}
        confirmLabel="Disconnect"
        destructive
        onConfirm={disconnect}
        onClose={() => setConfirmDisconnectOpen(false)}
      />
      {canManage && installed && (
        <ConnectionActions
          className="mb-4"
          primaryLabel="Reconfigure"
          onPrimary={() => setReconfigureOpen(true)}
          onDisconnect={() => setConfirmDisconnectOpen(true)}
        />
      )}
      {canManage && installed && webhookUrl && (
        <div className="mb-6 overflow-hidden rounded-lg border border-zGray-800/70 bg-surface">
          <div className="border-b border-zGray-800/60 px-4 py-3">
            <div className="text-[13px] font-medium text-main">Event request URL</div>
            <div className="mt-0.5 text-[12px] text-tertiary">
              Paste this into your Feishu / Lark app’s Event Configuration → Request URL, then
              publish a new version. This is the same URL from the connect wizard.
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-3">
            <code className="min-w-0 flex-1 truncate rounded-md border border-zGray-800 bg-zGray-900 px-2.5 py-2 font-mono text-[12px] text-main">
              {webhookUrl}
            </code>
            <button
              type="button"
              onClick={() => void copyWebhook()}
              className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-md border border-zGray-800 px-3 text-[12.5px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main"
            >
              <FontAwesomeIcon icon={webhookCopied ? faCheck : faCopy} className="h-3 w-3" />
              {webhookCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="border-t border-zGray-800/60 px-4 py-3">
            <div className="text-[12px] leading-relaxed text-tertiary">
              On the same tab, make sure the app subscribes to all {LARK_SUBSCRIBE_EVENTS.length}{' '}
              events:{' '}
              {LARK_SUBSCRIBE_EVENTS.map((ev, i) => (
                <span key={ev}>
                  {i > 0 && ', '}
                  <WizardCopyableValue value={ev} />
                </span>
              ))}
            </div>
            {consoleDomain && (
              <div className="mt-2.5">
                <WizardConsoleLink href={larkAppPageUrl(consoleDomain, consoleAppId, 'event')}>
                  Open your app’s Events &amp; Callbacks page
                </WizardConsoleLink>
              </div>
            )}
          </div>
        </div>
      )}

      {installed && (
        <LarkPairCard
          pairCode={pairCode}
          pairGenerating={pairGenerating}
          pairCopied={pairCopied}
          onGenerate={generatePairCode}
          onCopy={copyPairCode}
        />
      )}

      <div className="mb-8 overflow-hidden rounded-lg border border-zGray-800/70 bg-surface">
        <div className="border-b border-zGray-800/60 px-4 py-3">
          <div className="text-[13px] font-medium text-main">Groups</div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            Add the Nuphos bot to a Feishu / Lark group and it links automatically. Toggle which
            groups the agent responds in, then @mention Nuphos there.
          </div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">Loading…</div>
        ) : !canManage ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">
            Only team administrators can view and manage groups.
          </div>
        ) : !installed ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">
            Connect Lark first, then add the bot to a group.
          </div>
        ) : availableChats.length === 0 ? (
          <div className="px-4 py-5 text-[12.5px] leading-relaxed text-tertiary">
            <div className="mb-2 text-secondary">
              No groups linked yet. To add the bot to a Lark / Feishu group:
            </div>
            <ol className="ml-4 list-decimal space-y-1">
              <li>
                Open the group in Lark → tap the group name at the top →{' '}
                <span className="text-main">Settings</span>.
              </li>
              <li>
                Go to <span className="text-main">Group Bots</span> (群机器人) →{' '}
                <span className="text-main">Add Bot</span>.
              </li>
              <li>
                Search for your app —{' '}
                <span className="text-main">{installation?.tenantName || 'Nuphos'}</span> — and add
                it.
              </li>
              <li>
                Come back here and <span className="text-main">refresh</span> (top toolbar); the
                group appears automatically.
              </li>
            </ol>
            <div className="mt-3">
              Shortcut: just{' '}
              <span className="text-main">@mention {installation?.tenantName || 'Nuphos'}</span> in
              a group the bot is already in — it auto-links on the first mention.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-zGray-800/60">
            {availableChats.map((chat) => (
              <div key={chat.chatId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-main truncate">{chat.name}</div>
                  <div className="font-mono text-[11.5px] text-tertiary truncate">
                    {chat.chatId}
                  </div>
                </div>
                <Switch
                  checked={chat.enabled}
                  onChange={(next) => void toggleChat(chat, next)}
                  disabled={busyKey === `chat:${chat.chatId}`}
                  label={`${chat.enabled ? 'Disable' : 'Enable'} agent replies in ${chat.name}`}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage && (
        <LarkLinkedAccountsCard
          loading={loading}
          userMappings={userMappings}
          memberById={memberById}
          busyKey={busyKey}
          onDelete={deleteUser}
        />
      )}

      {!canManage && (
        <div className="mt-2 flex items-center gap-2 text-[12.5px] text-tertiary">
          <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />
          Ask a team administrator to link chats and manage Lark access.
        </div>
      )}
    </div>
  )
}
