import { X as XIcon } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { IconButton } from '../../components/ui/icon-button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { Field } from './shared'
import { inputClasses } from './styles'

import type { TeamWebhook, WebhookEvent, WebhookInput } from '../../types/webhooks'

/** `null` is closed, `'new'` adds one, a webhook edits it. */
export type WebhookEditorTarget = TeamWebhook | 'new' | null

type HeaderRow = { name: string; value: string; saved: boolean }
type Draft = { name: string; url: string; events: WebhookEvent[]; headers: HeaderRow[] }

const EVENT_LABELS: Record<WebhookEvent, { label: string; description: string }> = {
  'session.turn.completed': {
    label: t('Reply finished'),
    description: t('A conversation finished replying and has an answer.'),
  },
  'session.turn.failed': {
    label: t('Reply failed'),
    description: t('A conversation’s reply ended with an error.'),
  },
  'session.input_required': {
    label: t('Input needed'),
    description: t('A conversation is waiting for an answer, an approval or a sign-in.'),
  },
  'task.reported': {
    label: t('Task reported'),
    description: t('A Task reported a result or a blocker to its parent.'),
  },
}

function draftOf(target: WebhookEditorTarget): Draft {
  if (target === null || target === 'new')
    return { name: '', url: 'https://', events: ['session.turn.completed'], headers: [] }

  return {
    name: target.name,
    url: target.url,
    events: target.events,
    headers: target.headers.map((name) => ({ name, value: '', saved: true })),
  }
}

/** What to send: a saved header left blank keeps its stored value. */
function inputOf(draft: Draft): WebhookInput {
  return {
    name: draft.name.trim(),
    url: draft.url.trim(),
    events: draft.events,
    headers: draft.headers
      .filter((h) => h.name.trim())
      .map((h) => ({
        name: h.name.trim(),
        ...(h.value || !h.saved ? { value: h.value } : {}),
      })),
  }
}

function HeaderFields({
  headers,
  onChange,
}: {
  headers: HeaderRow[]
  onChange: (headers: HeaderRow[]) => void
}) {
  const setHeader = (index: number, patch: Partial<HeaderRow>) =>
    onChange(headers.map((h, i) => (i === index ? { ...h, ...patch } : h)))

  return (
    <fieldset>
      <legend className="mb-1.5 text-[12.5px] font-medium text-secondary">{t('Headers')}</legend>
      <p className="mb-2 text-[12px] text-tertiary">
        {t(
          'Sent with every request, e.g. Authorization: Bearer <key>. Values are stored encrypted and never shown again.',
        )}
      </p>
      <div className="space-y-2">
        {headers.map((header, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="w-2/5 shrink-0">
              <input
                value={header.name}
                onChange={(e) => setHeader(index, { name: e.target.value, saved: false })}
                placeholder="Authorization"
                aria-label={t('Header name')}
                className={inputClasses}
              />
            </div>
            <div className="min-w-0 flex-1">
              <input
                type="password"
                value={header.value}
                onChange={(e) => setHeader(index, { value: e.target.value })}
                placeholder={header.saved ? t('Saved. Leave blank to keep it.') : 'Bearer …'}
                aria-label={t('Header value')}
                className={inputClasses}
              />
            </div>
            <IconButton
              label={t('Remove header')}
              icon={<XIcon />}
              onClick={() => onChange(headers.filter((_, i) => i !== index))}
            />
          </div>
        ))}
      </div>
      {headers.length < 10 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => onChange([...headers, { name: '', value: '', saved: false }])}
        >
          + {t('Add header')}
        </Button>
      )}
    </fieldset>
  )
}

export function WebhookEditorDialog({
  target,
  events,
  onClose,
  onSubmit,
}: {
  target: WebhookEditorTarget
  events: WebhookEvent[]
  onClose: () => void
  onSubmit: (input: WebhookInput) => Promise<void>
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(target))
  const [saving, setSaving] = useState(false)
  const [openedFor, setOpenedFor] = useState<WebhookEditorTarget>(target)

  if (target !== openedFor) {
    setOpenedFor(target)
    setDraft(draftOf(target))
    setSaving(false)
  }

  const toggleEvent = (event: WebhookEvent, on: boolean) =>
    setDraft({
      ...draft,
      events: on ? [...draft.events, event] : draft.events.filter((e) => e !== event),
    })

  async function save() {
    const input = inputOf(draft)

    if (!input.name || !input.url.startsWith('https://') || input.events.length === 0) {
      toast.error(
        t('Missing details'),
        t('Give the webhook a name, an https:// URL and at least one event.'),
      )

      return
    }
    setSaving(true)
    try {
      await onSubmit(input)
      onClose()
    } catch (err) {
      toast.apiError(t('Couldn’t save the webhook'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target === 'new' ? t('New webhook') : t('Edit webhook')}
      description={t(
        'Nuphos sends a POST with a JSON body to this URL when a chosen event happens.',
      )}
      width={600}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? t('Saving…') : t('Save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <Field label={t('Name')}>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            maxLength={64}
            placeholder={t('e.g. Ops alerts')}
            className={inputClasses}
            autoFocus
          />
        </Field>
        <Field label={t('URL')}>
          <input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            maxLength={2048}
            placeholder="https://example.com/nuphos-webhook"
            className={inputClasses}
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-secondary">{t('Events')}</legend>
          <div className="space-y-2">
            {events.map((event) => (
              <label key={event} className="flex items-start gap-2.5">
                <Checkbox
                  className="mt-0.5"
                  checked={draft.events.includes(event)}
                  onCheckedChange={(on) => toggleEvent(event, on)}
                />
                <span className="text-[12.5px]">
                  <span className="text-main">{EVENT_LABELS[event].label}</span>{' '}
                  <code className="text-[11.5px] text-tertiary">{event}</code>
                  <span className="block text-tertiary">{EVENT_LABELS[event].description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <HeaderFields
          headers={draft.headers}
          onChange={(headers) => setDraft({ ...draft, headers })}
        />
      </div>
    </Modal>
  )
}
