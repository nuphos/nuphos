import clsx from 'clsx'
import { useState } from 'react'

import { MessageResponse } from '../../components/agent/MessageResponse'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { Field } from './shared'
import { inputClasses } from './styles'

import type { Instruction, InstructionLimits, InstructionScope } from '../../types/instructions'

export type InstructionEditorTarget =
  { kind: 'create'; scope: InstructionScope } | { kind: 'edit' | 'view'; instruction: Instruction }

type Draft = { title: string; content: string }

function EditorTabs({
  tab,
  onChange,
  used,
  limit,
}: {
  tab: 'write' | 'preview'
  onChange: (tab: 'write' | 'preview') => void
  used: number
  limit: number
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1">
      {(['write', 'preview'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={clsx(
            'rounded-md px-2 py-1 text-[12px] capitalize transition-colors',
            tab === value ? 'bg-zGray-800 text-main' : 'text-tertiary hover:text-secondary',
          )}
        >
          {value}
        </button>
      ))}
      <span className="ml-auto text-[11.5px] text-tertiary">
        {used.toLocaleString()} / {limit.toLocaleString()}
      </span>
    </div>
  )
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="max-h-[420px] min-h-[120px] overflow-y-auto rounded-md border border-zGray-800 px-3 py-2 text-[13px]">
      {content.trim() ? (
        <MessageResponse>{content}</MessageResponse>
      ) : (
        <p className="text-tertiary">Nothing to preview yet.</p>
      )}
    </div>
  )
}

function dialogTitle(target: InstructionEditorTarget): string {
  if (target.kind === 'view') return target.instruction.title
  const scope = target.kind === 'create' ? target.scope : target.instruction.scope
  const noun = scope === 'team' ? 'team instruction' : 'personal instruction'

  return target.kind === 'create' ? `New ${noun}` : `Edit ${noun}`
}

export function InstructionEditorDialog({
  target,
  limits,
  onClose,
  onSubmit,
}: {
  target: InstructionEditorTarget | null
  limits: InstructionLimits
  onClose: () => void
  onSubmit: (draft: Draft) => Promise<void>
}) {
  const [draft, setDraft] = useState<Draft>({ title: '', content: '' })
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [saving, setSaving] = useState(false)
  const [openedFor, setOpenedFor] = useState<InstructionEditorTarget | null>(null)

  if (target !== openedFor) {
    setOpenedFor(target)
    if (target) {
      const source = target.kind === 'create' ? null : target.instruction

      setDraft({ title: source?.title ?? '', content: source?.content ?? '' })
      setTab(target.kind === 'view' ? 'preview' : 'write')
      setSaving(false)
    }
  }
  const readOnly = target?.kind === 'view'

  async function save() {
    const title = draft.title.trim()
    const content = draft.content.trim()

    if (!title || !content) {
      toast.error('Missing details', 'Give the instruction a title and some content.')

      return
    }
    setSaving(true)
    try {
      await onSubmit({ title, content })
      onClose()
    } catch (err) {
      toast.apiError('Couldn’t save the instruction', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? dialogTitle(target) : ''}
      description="Markdown. Injected at the start of every new conversation."
      width={640}
      closeOnBackdrop={readOnly}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {!readOnly && (
          <Field label="Title">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              maxLength={limits.titleChars}
              placeholder="e.g. Deployment conventions"
              className={inputClasses}
              autoFocus
            />
          </Field>
        )}
        <div>
          {!readOnly && (
            <EditorTabs
              tab={tab}
              onChange={setTab}
              used={draft.content.length}
              limit={limits.contentChars}
            />
          )}
          {tab === 'write' && !readOnly ? (
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              maxLength={limits.contentChars}
              rows={14}
              placeholder={'- Always open a Plan before changing production.\n- Reply in English.'}
              className={clsx(inputClasses, 'h-auto resize-y py-2 font-mono text-[12.5px]')}
            />
          ) : (
            <MarkdownPreview content={draft.content} />
          )}
        </div>
      </div>
    </Modal>
  )
}
