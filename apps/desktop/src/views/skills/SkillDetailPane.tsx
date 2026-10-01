import { AlertTriangle, X } from 'lucide-react'

import { Age } from '../../components/Age'
import { DetailSidebarTransition } from '../../components/DetailSidebarTransition'
import { Button } from '../../components/ui/button'
import { formatBytes } from '../../grafana/format'

import { SkillFilesSection, SkillHistorySection, SkillUploadSection } from './SkillDetailSections'

import type {
  TeamSkillHistory,
  TeamSkillObject,
  TeamSkillObjectDetail,
  TeamSkillSummary,
} from '../../api'
import type { TeamMember } from '../../types'
import type { RefObject } from 'react'

export function SkillDetailPane({
  skill,
  files,
  history,
  members,
  skillMd,
  loading,
  uploadKey,
  onUploadKeyChange,
  uploading,
  canEdit,
  canDelete,
  fileInputRef,
  onUploadFile,
  onDeleteFile,
  onDeleteSkill,
  onClose,
}: {
  skill: TeamSkillSummary
  files: TeamSkillObject[]
  history: TeamSkillHistory | null
  members: TeamMember[]
  skillMd: TeamSkillObjectDetail | null
  loading: boolean
  uploadKey: string
  onUploadKeyChange: (value: string) => void
  uploading: boolean
  canEdit: boolean
  canDelete: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onUploadFile: (file: File, keyOverride?: string) => void
  onDeleteFile: (key: string) => void
  onDeleteSkill: () => void
  onClose: () => void
}) {
  const prefix = `skills/${skill.name}/`
  const metadata = history?.metadata ?? skill.metadata
  const memberName = (userId: string | null | undefined) => {
    if (!userId) return 'Unknown'
    const member = members.find((entry) => entry.id === userId)

    return member?.name || member?.username || userId.slice(0, 8)
  }
  const historyEvents = history?.events.filter((event) => event.phase === 'result') ?? []

  return (
    <DetailSidebarTransition
      onClose={onClose}
      className="w-[420px] flex-shrink-0 min-h-0 flex flex-col bg-zGray-925/40"
    >
      {(requestClose) => (
        <>
          <div className="px-4 py-3 border-b border-zGray-800/60 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] uppercase tracking-wide text-tertiary">Team skill</div>
              <div className="text-[13px] text-main truncate" title={skill.displayName}>
                {skill.displayName}
              </div>
              <div className="mt-1 text-[11px] text-tertiary font-mono truncate">{skill.name}</div>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="h-7 w-7 rounded-md text-tertiary hover:text-main hover:bg-zGray-800 flex items-center justify-center"
              title="Close details"
              aria-label="Close details"
            >
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin p-4 space-y-4">
            {!skill.hasSkillMd && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                <span>
                  No <code className="font-mono">SKILL.md</code> — the agent will skip this skill
                  directory.
                </span>
              </div>
            )}

            {skill.description && (
              <section className="space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-tertiary">Description</div>
                <p className="text-[12.5px] text-secondary leading-relaxed">{skill.description}</p>
              </section>
            )}

            <section className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-tertiary">Summary</div>
              <div className="text-[12px] text-secondary">
                {skill.fileCount} file{skill.fileCount === 1 ? '' : 's'} ·{' '}
                {formatBytes(skill.totalBytes)}
                {skill.lastModified ? (
                  <>
                    {' '}
                    · modified <Age value={skill.lastModified} />
                  </>
                ) : null}
              </div>
            </section>

            {metadata && (
              <section className="space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-tertiary">Provenance</div>
                <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1 text-[12px]">
                  <span className="text-tertiary">Created by</span>
                  <span
                    className="truncate text-secondary"
                    title={metadata.createdByUserId ?? undefined}
                  >
                    {metadata.legacy ? 'Unknown (legacy)' : memberName(metadata.createdByUserId)}
                  </span>
                  <span className="text-tertiary">Source</span>
                  <span className="font-mono text-secondary">{metadata.createdSource}</span>
                  <span className="text-tertiary">Revision</span>
                  <span className="font-mono text-secondary">{metadata.revision}</span>
                  <span className="text-tertiary">Last changed by</span>
                  <span
                    className="truncate text-secondary"
                    title={metadata.updatedByUserId ?? undefined}
                  >
                    {memberName(metadata.updatedByUserId)}
                    {metadata.updatedAt ? (
                      <>
                        {' '}
                        · <Age value={metadata.updatedAt} />
                      </>
                    ) : null}
                  </span>
                </div>
                {metadata.legacy && (
                  <p className="text-[11px] leading-relaxed text-tertiary">
                    This skill predates provenance tracking, so its original creator is not
                    inferred.
                  </p>
                )}
              </section>
            )}

            {loading ? (
              <div className="text-[12px] text-tertiary">Loading files…</div>
            ) : (
              <>
                {skillMd?.text && (
                  <section className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">
                      SKILL.md
                    </div>
                    <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-zGray-800/60 bg-zGray-950 px-3 py-2 font-mono text-[11px] text-secondary">
                      {skillMd.text}
                    </pre>
                    {skillMd.textTruncated && (
                      <p className="text-[11px] text-tertiary">
                        Preview truncated — file is too large to inline.
                      </p>
                    )}
                  </section>
                )}

                {historyEvents.length > 0 && (
                  <SkillHistorySection events={historyEvents} memberName={memberName} />
                )}

                {canEdit && (
                  <SkillUploadSection
                    prefix={prefix}
                    uploadKey={uploadKey}
                    onUploadKeyChange={onUploadKeyChange}
                    uploading={uploading}
                    fileInputRef={fileInputRef}
                    onUploadFile={onUploadFile}
                  />
                )}

                <SkillFilesSection
                  files={files}
                  prefix={prefix}
                  canDelete={canDelete}
                  onDeleteFile={onDeleteFile}
                />

                {canDelete && files.length > 0 && (
                  <Button
                    variant="secondary"
                    className="h-8 w-full text-[12px] text-red-400 hover:text-red-300"
                    onClick={onDeleteSkill}
                  >
                    Delete entire skill
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </DetailSidebarTransition>
  )
}
