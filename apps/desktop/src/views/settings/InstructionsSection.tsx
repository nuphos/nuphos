import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useInstructions } from '../../hooks/useInstructions'
import { t } from '../../i18n'

import { InstructionCard } from './InstructionCard'
import { InstructionEditorDialog } from './InstructionEditorDialog'
import { SectionHeader } from './shared'

import type { InstructionEditorTarget } from './InstructionEditorDialog'
import type { AtlasTeam } from '../../types'
import type { Instruction, InstructionScope } from '../../types/instructions'

const GROUPS: Record<
  InstructionScope,
  { title: string; header: string; headerDescription: string; description: string }
> = {
  team: {
    title: t('Team'),
    header: t('Instructions'),
    headerDescription: t(
      'Standing guidance every new agent in this team follows, like CLAUDE.md or AGENTS.md. Applies to every agent, including Slack, Discord, and trigger runs.',
    ),
    description: t('Shared with everyone in this workspace. Injected first.'),
  },
  personal: {
    title: t('Personal'),
    header: t('Personal instructions'),
    headerDescription: t(
      'Your own standing guidance for your agents in this team. Nobody else in the team sees or receives it.',
    ),
    description: t('Only apply to your own agents. Injected after team instructions.'),
  },
}

export function InstructionsSection({
  team,
  scope,
}: {
  team: AtlasTeam | undefined
  scope: InstructionScope
}) {
  const { listing, loading, refresh } = useInstructions(team?.id)
  const [editor, setEditor] = useState<InstructionEditorTarget | null>(null)
  const [deleting, setDeleting] = useState<Instruction | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const canEdit = (target: InstructionScope) =>
    target === 'personal' || Boolean(listing?.canManageTeam)

  async function toggle(instruction: Instruction, enabled: boolean) {
    if (!team) return
    setBusyId(instruction.id)
    try {
      await api.atlasUpdateInstruction(team.id, instruction.id, { enabled })
      refresh()
    } catch (err) {
      toast.apiError(t('Couldn’t update the instruction'), err)
    } finally {
      setBusyId(null)
    }
  }

  async function submit(draft: { title: string; content: string }) {
    if (!team || !editor || editor.kind === 'view') return
    if (editor.kind === 'create') {
      await api.atlasCreateInstruction(team.id, { scope: editor.scope, ...draft })
    } else {
      await api.atlasUpdateInstruction(team.id, editor.instruction.id, draft)
    }
    toast.success(t('Instruction saved'))
    refresh()
  }

  async function remove(instruction: Instruction) {
    if (!team) return
    try {
      await api.atlasDeleteInstruction(team.id, instruction.id)
      toast.success(t('Instruction deleted'))
      refresh()
    } catch (err) {
      toast.apiError(t('Couldn’t delete the instruction'), err)
    }
  }

  return (
    <div>
      <SectionHeader title={GROUPS[scope].header} description={GROUPS[scope].headerDescription} />
      {loading && !listing && (
        <div aria-busy="true" className="space-y-3">
          <div className="h-16 animate-pulse rounded-xl bg-zGray-800/40" />
          <div className="h-16 animate-pulse rounded-xl bg-zGray-800/40" />
        </div>
      )}
      {team && listing && (
        <InstructionGroup
          scope={scope}
          items={listing[scope]}
          editable={canEdit(scope)}
          full={listing[scope].length >= listing.limits.snippetsPerScope}
          busyId={busyId}
          onAdd={() => setEditor({ kind: 'create', scope })}
          onToggle={(instruction, enabled) => void toggle(instruction, enabled)}
          onOpen={(instruction, editable) =>
            setEditor({ kind: editable ? 'edit' : 'view', instruction })
          }
          onDelete={setDeleting}
        />
      )}
      {listing && (
        <InstructionEditorDialog
          target={editor}
          limits={listing.limits}
          onClose={() => setEditor(null)}
          onSubmit={submit}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('Delete instruction')}
        description={t('Delete “{title}”? New agents will stop receiving it.', {
          title: deleting?.title ?? '',
        })}
        confirmLabel={t('Delete')}
        destructive
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

function InstructionGroup({
  scope,
  items,
  editable,
  full,
  busyId,
  onAdd,
  onToggle,
  onOpen,
  onDelete,
}: {
  scope: InstructionScope
  items: Instruction[]
  editable: boolean
  full: boolean
  busyId: string | null
  onAdd: () => void
  onToggle: (instruction: Instruction, enabled: boolean) => void
  onOpen: (instruction: Instruction, editable: boolean) => void
  onDelete: (instruction: Instruction) => void
}) {
  const group = GROUPS[scope]

  return (
    <section>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-main">{group.title}</h2>
          <p className="mt-0.5 text-[12.5px] text-tertiary">
            {group.description}
            {!editable && ` ${t('Only workspace administrators can change them.')}`}
          </p>
        </div>
        {editable && (
          <Button type="button" size="sm" disabled={full} onClick={onAdd}>
            + {t('Add')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zGray-800 p-6 text-sm text-tertiary">
          {editable
            ? scope === 'team'
              ? t('No team instructions yet.')
              : t('No personal instructions yet.')
            : t('No team instructions yet. Ask a workspace administrator to add some.')}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((instruction) => (
            <InstructionCard
              key={instruction.id}
              instruction={instruction}
              canEdit={editable}
              busy={busyId === instruction.id}
              onToggle={(enabled) => onToggle(instruction, enabled)}
              onOpen={() => onOpen(instruction, editable)}
              onDelete={() => onDelete(instruction)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
