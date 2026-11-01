import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

const FIELD =
  'w-full rounded-md border border-main bg-surface px-3 py-2 text-[13px] text-main outline-none focus:border-zViolet-500'

/** Ask the agent to change the selected screens: the request, in the user's words. Mount it to open it. */
export function AskAgentDialog({
  screens,
  onClose,
  onSend,
}: {
  screens: string[]
  onClose: () => void
  onSend: (request: string) => void
}) {
  const [request, setRequest] = useState('')

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Ask the agent to edit')}
      appearance="prompt"
      description={
        screens.length === 1
          ? t('The agent will change “{screen}” and update it here.', {
              screen: screens[0] ?? '',
            })
          : t('The agent will change {count} screens and update them here.', {
              count: screens.length,
            })
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={!request.trim()} onClick={() => onSend(request)}>
            {t('Send to agent')}
          </Button>
        </div>
      }
    >
      <textarea
        autoFocus
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && request.trim()) onSend(request)
        }}
        rows={4}
        placeholder={t('Make the primary button larger and move the sign-up link under the form')}
        aria-label={t('Request')}
        className={`${FIELD} resize-none`}
      />
    </Modal>
  )
}

/** Rename a page or a design. Mount it to open it. */
export function RenamePageDialog({
  name,
  title = t('Rename page'),
  onClose,
  onSave,
}: {
  name: string
  title?: string
  onClose: () => void
  onSave: (name: string) => void
}) {
  const [draft, setDraft] = useState(name)
  const save = () => {
    const next = draft.trim()

    if (next) onSave(next)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      appearance="prompt"
      width={400}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={!draft.trim()} onClick={save}>
            {t('Rename')}
          </Button>
        </div>
      }
    >
      <input
        autoFocus
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
        maxLength={100}
        aria-label={t('Name')}
        className={FIELD}
      />
    </Modal>
  )
}
