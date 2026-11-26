import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { useNewConversationRuntime } from '../agent/panel/useNewConversationRuntime'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
import { AppSelect } from '../ui/select'
import { ipcErrorMessage, useBotTemplates } from './botTemplates'
import { loadChannelAhead } from './useChannel'

import type { BotImportTarget } from '../../api/bot-import-types'

export function BotTemplateDialog({
  teamId,
  template,
  onClose,
  onOpen,
}: {
  teamId: string
  template: { id: string; version: string }
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const client = useQueryClient()
  const runtimes = useNewConversationRuntime(teamId)
  const [runtimeId, setRuntimeId] = useState('')
  const activeRuntimes = runtimes.runtimeInstances.filter((runtime) => runtime.status === 'active')
  const selected = activeRuntimes.find((runtime) => runtime.id === runtimeId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef<{ copyId: string; target: BotImportTarget } | null>(null)
  // A retry repeats the first attempt on its runtime, so the choice is locked once tried.
  const [locked, setLocked] = useState(false)
  const running = useRef(false)
  const templates = useBotTemplates()
  const card = templates.data?.find((entry) => entry.id === template.id)

  async function add() {
    if (!card || running.current) return
    if (!attempt.current && selected) {
      attempt.current = {
        copyId: crypto.randomUUID(),
        target: { teamId, runtimeId: selected.id, agentRuntime: selected.provider },
      }
      setLocked(true)
    }
    const operation = attempt.current

    if (!operation) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const { copyId, target } = operation
      const preview = await api.agentChooseBotImport(target, copyId, template)

      if (!preview) throw new Error(t('Could not load this template.'))
      const next =
        preview.items.some((item) => item.state === 'applied') || preview.running
          ? preview
          : await api.agentApplyBotImport(target, preview.id, {
              botKeys: preview.manifest.bots.map((bot) => bot.key),
              chatKeys: [],
              enableSchedules: false,
              scheduleActivationConfirmed: false,
            })
      const bot = next.items.find((item) => item.kind === 'bot' && item.state === 'applied')

      if (!bot)
        throw new Error(
          next.items.find((item) => item.error)?.error ?? t('The Bot is not ready yet. Try again.'),
        )
      const chatId = bot.privateChatId ?? bot.sessionId

      // A template names a built-in avatar instead of shipping an image, so the bundle
      // carries none; give the Bot the one the template shows. A failure keeps the
      // Bot's default avatar rather than failing an import that already succeeded.
      await api
        .agentSetConversationAvatar(bot.sessionId, card.avatar.replace(/\.svg$/, ''), teamId)
        .catch(() => undefined)

      // Opened only once the sidebar lists the Bot (with its runtime state, so its first
      // turn shows as under way) and its chat is in memory: no blank screen in between.
      await Promise.all([
        client.refetchQueries({ queryKey: queryKeys.agentSessions(teamId) }),
        loadChannelAhead(client, teamId, chatId),
      ])
      onOpen(chatId)
      onClose()
    } catch (cause) {
      setError(ipcErrorMessage(cause, t('Could not add the Bot. Try again.')))
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const idleLabel = error ? t('Retry') : t('Add Bot')
  const buttonLabel = busy ? t('Adding…') : idleLabel

  return (
    <Modal
      open
      title={t('Use this template')}
      width={420}
      onClose={() => {
        if (!running.current) onClose()
      }}
    >
      <div className="space-y-5 p-5 text-sm text-primary">
        {card ? (
          <>
            <div className="space-y-2 text-center">
              <BotAvatarImage file={card.avatar} className="mx-auto size-14 object-contain" />
              <h2 className="text-lg font-semibold">{card.name}</h2>
              <p className="flex items-center justify-center gap-1 text-xs text-secondary">
                {card.official && <BadgeCheck className="size-3.5" aria-hidden="true" />}
                {card.official
                  ? t('Official template by {author}', { author: card.author })
                  : t('By {author}', { author: card.author })}{' '}
                · {card.category}
              </p>
              <p className="text-secondary">{card.summary}</p>
            </div>
            <div className="divide-y divide-line-control rounded-xl border border-line-control">
              <details className="p-3">
                <summary className="cursor-pointer font-medium">{t('What it does')}</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-secondary">
                  {card.highlights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
              {card.integrations.length > 0 ? (
                <details className="p-3">
                  <summary className="cursor-pointer font-medium">
                    {t('Integrations')} · {card.integrations.map((item) => item.name).join(', ')}
                  </summary>
                  <ul className="mt-2 space-y-1 text-secondary">
                    {card.integrations.map((item) => (
                      <li key={item.name}>
                        <span className="font-medium text-primary">{item.name}</span> (
                        {item.required ? t('Required') : t('Optional')}): {item.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="p-3 font-medium">
                  {t('Integrations')} · <span className="text-secondary">{t('None needed')}</span>
                </p>
              )}
            </div>
            <div className="space-y-2">
              {error && (
                <p role="alert" className="text-status-danger">
                  {error}
                </p>
              )}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2">
                <label htmlFor="template-runtime" className="col-span-2 font-medium">
                  {t('Runtime')} <span className="text-xs text-secondary">({t('Required')})</span>
                </label>
                <AppSelect
                  id="template-runtime"
                  placeholder={t('Choose a runtime')}
                  value={selected?.id ?? ''}
                  onValueChange={setRuntimeId}
                  disabled={busy || locked || activeRuntimes.length === 0}
                  className="min-w-0"
                  triggerClassName="max-w-full"
                  options={activeRuntimes.map((runtime) => ({
                    value: runtime.id,
                    label: runtime.label,
                  }))}
                />
                <Button disabled={busy || (!selected && !locked)} onClick={() => void add()}>
                  {buttonLabel}
                </Button>
                {activeRuntimes.length === 0 && (
                  <p className="col-span-2 text-xs text-secondary">
                    {runtimes.runtimeInstancesLoading
                      ? t('Loading runtimes…')
                      : t('No runtimes available.')}
                  </p>
                )}
              </div>
            </div>
          </>
        ) : templates.isPending ? (
          <p className="text-secondary">{t('Loading template…')}</p>
        ) : (
          <div className="space-y-3">
            <p role="alert">
              {templates.isError
                ? t('Could not load Bot templates.')
                : t('This template is unavailable.')}
            </p>
            {templates.isError && (
              <Button variant="secondary" onClick={() => void templates.refetch()}>
                {t('Retry')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
