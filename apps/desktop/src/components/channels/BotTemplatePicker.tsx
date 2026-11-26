import { BadgeCheck } from 'lucide-react'

import { t } from '../../i18n'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { Modal } from '../Modal'
import { Button } from '../ui/button'

import { useBotTemplates } from './botTemplates'

/** "Start from a template": the catalog from nuphos/bot-templates, one row per template. */
export function BotTemplatePicker({
  onPick,
  onClose,
}: {
  onPick: (template: { id: string; version: string }) => void
  onClose: () => void
}) {
  const templates = useBotTemplates()

  return (
    <Modal open title={t('Start from a template')} width={480} onClose={onClose}>
      <div className="space-y-2 p-5 text-sm text-primary">
        {templates.isPending && <p className="text-secondary">{t('Loading templates…')}</p>}
        {templates.isError && (
          <div className="space-y-3">
            <p role="alert">{t('Could not load Bot templates.')}</p>
            <Button variant="secondary" onClick={() => void templates.refetch()}>
              {t('Retry')}
            </Button>
          </div>
        )}
        {templates.data?.length === 0 && <p className="text-secondary">{t('No templates yet.')}</p>}
        {templates.data?.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onPick({ id: template.id, version: template.version })}
            className="flex w-full items-start gap-3 rounded-xl border border-line-control p-3 text-left hover:bg-[var(--sidebar-overlay-hover)]"
          >
            <BotAvatarImage file={template.avatar} className="size-10 shrink-0 object-contain" />
            <span className="min-w-0 space-y-0.5">
              <span className="flex items-center gap-1 font-medium">
                {template.name}
                {template.official && (
                  <BadgeCheck
                    className="size-3.5 text-secondary"
                    aria-label={t('Official template by {author}', { author: template.author })}
                  />
                )}
              </span>
              <span className="block text-xs text-tertiary">{template.category}</span>
              <span className="block text-secondary">{template.summary}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
