import { X as XIcon } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { IconButton } from '../../components/ui/icon-button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { draftOf, inputOf, updateDraftUrl } from './mcpServerEditorDraft'
import { Field } from './shared'
import { inputClasses } from './styles'

import type { Draft, HeaderRow, McpServerEditorTarget } from './mcpServerEditorDraft'
import type { McpServerInput } from '../../types/mcp-servers'

export type { McpServerEditorTarget }

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

export function McpServerEditorDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: McpServerEditorTarget
  onClose: () => void
  onSubmit: (input: McpServerInput) => Promise<void>
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(target))
  const [saving, setSaving] = useState(false)
  const [openedFor, setOpenedFor] = useState<McpServerEditorTarget>(target)

  if (target !== openedFor) {
    setOpenedFor(target)
    setDraft(draftOf(target))
    setSaving(false)
  }

  const originalUrl = target && target !== 'new' ? target.url : undefined

  async function save() {
    const input = inputOf(draft, originalUrl)

    if (!input.name || !/^https?:\/\//i.test(input.url)) {
      toast.error(t('Missing details'), t('Give the MCP server a name and a valid URL.'))

      return
    }
    setSaving(true)
    try {
      await onSubmit(input)
      onClose()
    } catch (err) {
      toast.apiError(t('Couldn’t save the MCP server'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target === 'new' ? t('New MCP server') : t('Edit MCP server')}
      description={t(
        'Remote MCP servers registered here can be selected in a conversation’s connector menu.',
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
            placeholder={t('e.g. Homelab MCP')}
            className={inputClasses}
            autoFocus
          />
        </Field>
        <Field label={t('URL')}>
          <input
            value={draft.url}
            onChange={(e) => setDraft(updateDraftUrl(draft, e.target.value, originalUrl))}
            maxLength={2048}
            placeholder="https://example.com/mcp"
            className={inputClasses}
          />
        </Field>
        <HeaderFields
          headers={draft.headers}
          onChange={(headers) => setDraft({ ...draft, headers })}
        />
      </div>
    </Modal>
  )
}
