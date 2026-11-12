import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { useNewConversationRuntime } from '../agent/panel/useNewConversationRuntime'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
import { SetupReview } from './BotImportSetupReview'
import { BotImportGuide } from './BotImportGuide'

import type { BotImportPreview, BotImportTarget } from '../../api/bot-import-types'

export function BotImportDialog({
  teamId,
  onClose,
  onOpen,
}: {
  teamId: string
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const runtimes = useNewConversationRuntime(teamId)
  const [preview, setPreview] = useState<BotImportPreview | null>(null)
  const [target, setTarget] = useState<BotImportTarget | null>(null)
  const [botKeys, setBotKeys] = useState<string[]>([])
  const [chatKeys, setChatKeys] = useState<string[]>([])
  const [enableSchedules, setEnableSchedules] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(false)
  const selected = runtimes.newConversationRuntime
  const destination = selected?.label ?? t('Choose an agent')
  const server = new URL(window.api.apiUrlSync()).host

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Import could not finish. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const choose = (newCopy = false) =>
    run(async () => {
      if (!selected) throw new Error(t('Choose an available agent first.'))
      const picked = { teamId, runtimeId: selected.id, agentRuntime: selected.provider }
      const next = await api.agentChooseBotImport(picked, newCopy)

      if (!next) return
      setPreview(next)
      setTarget(picked)
      setBotKeys(next.selection?.botKeys ?? next.manifest.bots.map((bot) => bot.key))
      setChatKeys(next.selection?.chatKeys ?? next.manifest.chats.map((chat) => chat.key))
      setEnableSchedules(next.selection?.enableSchedules ?? false)
      setResult(next.running || next.items.some((item) => item.state !== 'pending'))
    })

  const apply = () =>
    run(async () => {
      if (!preview || !target) return
      const next = await api.agentApplyBotImport(target, preview.id, {
        botKeys,
        chatKeys,
        enableSchedules,
        scheduleActivationConfirmed: enableSchedules,
      })

      setPreview(next)
      setResult(true)
    })

  return (
    <Modal open title={t('Import from Grok Bot')} width={680} onClose={onClose}>
      <div className="space-y-5 p-5 text-sm text-primary">
        <p className="text-secondary">
          {t(
            'Bring your Bots, shared chats and working context into Nuphos. Review everything before creating anything.',
          )}
        </p>
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger p-3 text-status-danger">
            {error}
          </p>
        )}
        {preview && target && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setPreview(await api.agentGetBotImportStatus(target, preview.id))
                setResult(true)
              })
            }
          >
            {t('Refresh import status')}
          </Button>
        )}
        {!preview && (
          <BotImportGuide
            busy={busy}
            selectedId={selected?.id}
            runtimeInstances={runtimes.runtimeInstances}
            server={server}
            destination={destination}
            onSave={() => void run(() => api.agentSaveGrokExportSkill())}
            onChoose={() => void choose()}
            onRuntimeChange={runtimes.selectConversationRuntime}
          />
        )}
        {preview && !result && (
          <>
            <div className="rounded-lg border border-line-control p-3">
              <p className="font-medium">{t('Review before importing')}</p>
              <p className="text-secondary">
                {server} · {target?.runtimeId}
              </p>
              <p className="text-xs text-tertiary">
                {t(
                  'Previously completed items are kept. Retry finishes incomplete items; creating another copy is a separate choice.',
                )}
              </p>
            </div>
            <div className="max-h-[45vh] space-y-3 overflow-y-auto">
              {preview.manifest.bots.map((bot) => (
                <SetupReview
                  key={bot.key}
                  setup={bot}
                  selected={botKeys.includes(bot.key)}
                  onSelect={(checked) =>
                    setBotKeys((keys) =>
                      checked ? [...keys, bot.key] : keys.filter((key) => key !== bot.key),
                    )
                  }
                >
                  {preview.avatars?.[bot.key] && (
                    <img
                      src={preview.avatars[bot.key]}
                      width={48}
                      height={48}
                      alt={bot.name}
                      className="rounded-full"
                    />
                  )}
                  <p className="text-secondary">
                    {bot.skills.length} {t('skills')} · {bot.memories.length} {t('memories')} ·{' '}
                    {bot.files.length} {t('files')}
                  </p>
                  {bot.skills.length > 0 && (
                    <p className="text-xs text-tertiary">
                      {t(
                        'Skills are added to your personal library under imported names; they do not replace team skills.',
                      )}
                    </p>
                  )}
                  {bot.files.length > 0 && (
                    <p className="text-xs text-tertiary">
                      {t(
                        'Files are copied through the transfer store into a separate imported folder for this Bot. Existing files are never replaced.',
                      )}
                    </p>
                  )}
                </SetupReview>
              ))}
              {preview.manifest.chats.map((chat) => (
                <SetupReview
                  key={chat.key}
                  setup={chat}
                  selected={chatKeys.includes(chat.key)}
                  onSelect={(checked) =>
                    setChatKeys((keys) =>
                      checked ? [...keys, chat.key] : keys.filter((key) => key !== chat.key),
                    )
                  }
                >
                  <p className="text-secondary">
                    {t('Shared chat')} ·{' '}
                    {chat.members
                      .map(
                        (key) => preview.manifest.bots.find((bot) => bot.key === key)?.name ?? key,
                      )
                      .join(', ')}
                  </p>
                  {chat.lead && (
                    <p className="text-secondary">
                      {t('Lead')}:{' '}
                      {preview.manifest.bots.find((bot) => bot.key === chat.lead)?.name}
                    </p>
                  )}
                </SetupReview>
              ))}
            </div>
            <label className="flex items-start gap-2 rounded-lg border border-line-control p-3">
              <input
                type="checkbox"
                checked={enableSchedules}
                onChange={(event) => setEnableSchedules(event.target.checked)}
                disabled={busy}
              />
              <span>
                {t(
                  'I confirm: enable the supported schedules marked active in this preview. They can run automatically on the destination agent. Leave unchecked to create schedules disabled.',
                )}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || botKeys.length + chatKeys.length === 0}
                onClick={() => void apply()}
              >
                {busy ? t('Importing…') : t('Import selected')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setPreview(null)
                  setTarget(null)
                }}
              >
                {t('Choose another file')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void choose(true)}>
                {t('Create another copy…')}
              </Button>
            </div>
          </>
        )}
        {preview && result && (
          <>
            <h3 className="font-medium">{t('Import results')}</h3>
            {preview.running && (
              <p className="text-secondary">
                {t('Import is still running. Refresh to see the latest results.')}
              </p>
            )}
            <div className="max-h-[50vh] space-y-3 overflow-y-auto">
              {preview.items
                .filter((item) => (item.kind === 'bot' ? botKeys : chatKeys).includes(item.key))
                .map((item) => (
                  <section
                    key={`${item.kind}:${item.key}`}
                    className="space-y-1 rounded-lg border border-line-control p-3"
                  >
                    <p className="font-medium">
                      {
                        preview.manifest[item.kind === 'bot' ? 'bots' : 'chats'].find(
                          (setup) => setup.key === item.key,
                        )?.name
                      }{' '}
                      · {item.state === 'applied' ? t('Created') : t('Needs attention')}
                    </p>
                    {item.error && <p className="text-status-danger">{item.error}</p>}
                    {item.warnings.map((warning, index) => (
                      <p className="text-secondary" key={index}>
                        {warning}
                      </p>
                    ))}
                    {item.state === 'applied' && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          onClose()
                          onOpen(item.privateChatId ?? item.sessionId)
                        }}
                      >
                        {t('Open')}
                      </Button>
                    )}
                  </section>
                ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={busy || preview.running}
                onClick={() => void apply()}
              >
                {t('Retry incomplete items')}
              </Button>
              <Button onClick={onClose}>{t('Done')}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
