import clsx from 'clsx'
import { AlertCircle, Sparkles } from 'lucide-react'
import { createPortal } from 'react-dom'

import { ContextMenu } from '../components/ContextMenu'
import { EmptyState } from '../components/EmptyState'
import { Table } from '../components/Table'
import { useToolbarSlot } from '../hooks/useToolbarControls'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { LocalSkillImportMenu } from './skills/LocalSkillImportMenu'
import { buildSkillColumns } from './skills/skillColumns'
import { SkillDetailPane } from './skills/SkillDetailPane'
import { useSkillActions } from './skills/useSkillActions'
import { useTeamSkills } from './skills/useTeamSkills'

import type { TeamSkillSummary } from '../api'

type Props = {
  teamId: string
  currentUserId: string
  refreshKey: number
  filter?: string
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function TeamSkillsView({
  teamId,
  currentUserId,
  refreshKey,
  filter = '',
  onCount,
  onLoading,
  onOpenAgentChat,
}: Props) {
  const list = useTeamSkills({ teamId, currentUserId, refreshKey, filter, onCount, onLoading })
  const {
    state,
    members,
    selectedName,
    setSelectedName,
    skillMd,
    setSkillMd,
    skillFiles,
    setSkillFiles,
    skillHistory,
    setSkillHistory,
    detailLoading,
    setDetailLoading,
    uploadKey,
    setUploadKey,
    uploading,
    setUploading,
    menu,
    setMenu,
    detailRequestRef,
    fileInputRef,
    canEdit,
    canDelete,
    reloadWithSkeleton,
    rows,
    selectedSkill,
  } = list
  const { loadSkillDetail, deleteObject, deleteSkill, uploadFile, menuItems } = useSkillActions({
    teamId,
    filter,
    state,
    canEdit,
    canDelete,
    selectedName,
    setSelectedName,
    setSkillMd,
    setSkillFiles,
    setSkillHistory,
    setDetailLoading,
    uploadKey,
    setUploadKey,
    setUploading,
    menu,
    detailRequestRef,
    fileInputRef,
    reloadWithSkeleton,
  })

  // Drop the slot in the states below that render no list, so the controls row
  // never lingers as an empty band.
  const { isActive } = useWorkspaceTab()
  const importSlot = useToolbarSlot('right', isActive && state.kind !== 'error')

  if (state.kind === 'error') {
    if (state.unconfigured) {
      return (
        <EmptyState
          icon={Sparkles}
          title="Skills"
          description={
            <>
              The skills store is not configured. Set{' '}
              <code className="px-1 py-0.5 bg-zGray-900/60 rounded">ATLAS_SKILLS_BUCKET</code> and
              related S3 credentials on the backend to enable team-shared agent skills.
            </>
          }
        />
      )
    }

    return (
      <div className="px-6 py-8 flex items-start gap-2 text-[12px] text-red-400">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
        <span>Failed to load skills: {state.message}</span>
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-h-0">
      {importSlot &&
        createPortal(
          <LocalSkillImportMenu
            teamId={teamId}
            disabled={!canEdit}
            onImported={(name) => {
              void reloadWithSkeleton().then(() => setSelectedName(name))
            }}
          />,
          importSlot,
        )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
      <div
        className={clsx(
          'flex flex-col min-h-0',
          selectedSkill ? 'flex-1 min-w-0 border-r border-zGray-800/60' : 'flex-1 min-w-0',
        )}
      >
        {state.kind === 'ready' && rows.length === 0 && !filter.trim() ? (
          <EmptyState
            icon={Sparkles}
            title="Skills"
            description={
              <>
                Skills are reusable instructions that teach the agent how your team works. Ask the
                agent to create one, or upload skill directories under{' '}
                <code className="px-1 py-0.5 bg-zGray-900/60 rounded">skills/&lt;name&gt;/</code> to
                your team bucket.
              </>
            }
            agentAction={{
              label: 'Create a skill for me',
              prompt:
                'Create a team skill for me — ask me what workflow or convention it should teach, then write and save it.',
            }}
            onOpenAgentChat={onOpenAgentChat}
          />
        ) : (
          <Table<TeamSkillSummary>
            loading={state.kind === 'loading'}
            rows={rows}
            rowKey={(row) => row.name}
            selectedKey={selectedName}
            onPrimaryAction={(row) => void loadSkillDetail(row)}
            onRowContextMenu={(row, event) =>
              canDelete ? setMenu({ skill: row, x: event.clientX, y: event.clientY }) : undefined
            }
            storageKey="team-skills"
            empty="No skills match your search."
            columns={buildSkillColumns()}
          />
        )}
      </div>
      {selectedSkill && (
        <SkillDetailPane
          skill={selectedSkill}
          files={skillFiles}
          history={skillHistory}
          members={members}
          skillMd={skillMd}
          loading={detailLoading}
          uploadKey={uploadKey}
          onUploadKeyChange={setUploadKey}
          uploading={uploading}
          canEdit={canEdit}
          canDelete={canDelete}
          fileInputRef={fileInputRef}
          onUploadFile={(file) => void uploadFile(file)}
          onDeleteFile={(key) => void deleteObject(key)}
          onDeleteSkill={() => void deleteSkill(selectedSkill)}
          onClose={() => {
            setSelectedName(null)
            setSkillMd(null)
            setSkillFiles([])
            setSkillHistory(null)
          }}
        />
      )}
    </div>
  )
}
