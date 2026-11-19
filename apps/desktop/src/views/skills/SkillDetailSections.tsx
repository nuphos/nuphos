import clsx from 'clsx'
import { Trash2, Upload } from 'lucide-react'

import { Age } from '../../components/Age'
import { VisibleErrorReporter } from '../../components/VisibleErrorReporter'
import { Button } from '../../components/ui/button'
import { INLINE_LINK } from '../../components/ui/inline-link'
import { formatBytes } from '../../grafana/format'
import { t } from '../../i18n'

import { originUrl } from './githubSkillUpdates'
import { useSyncedFrom } from './useSyncedFrom'

import type { SkillScope, TeamSkillHistory, TeamSkillObject, TeamSkillOrigin } from '../../api'
import type { RefObject } from 'react'

export function SkillHistorySection({
  events,
  memberName,
}: {
  events: TeamSkillHistory['events']
  memberName: (userId: string | null | undefined) => string
}) {
  return (
    <section className="space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('History')}</div>
      <div className="overflow-hidden rounded-md border border-line-control/60">
        {events.slice(0, 20).map((event) => (
          <div key={event.id} className="border-b border-line-control/40 px-3 py-2 last:border-b-0">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-mono text-main">{event.action.replaceAll('_', ' ')}</span>
              <span
                className={clsx(
                  'font-mono text-[11px]',
                  event.status === 'applied'
                    ? 'text-status-success'
                    : event.status === 'failed' || event.status === 'partial'
                      ? 'text-status-danger'
                      : 'text-tertiary',
                )}
              >
                {event.status}
              </span>
              <span className="ml-auto font-mono text-[11px] text-tertiary">
                {event.revision === null ? '—' : `r${String(event.revision)}`}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-tertiary">
              {t('{name} via {source}', {
                name: memberName(event.actorUserId),
                source: event.source,
              })}{' '}
              · <Age value={event.createdAt} />
            </div>
            {event.error && (
              <div className="mt-1 line-clamp-2 text-[11px] text-status-danger" title={event.error}>
                <VisibleErrorReporter message={event.error} surface="skill_history_error" />
                {event.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export function SkillUploadSection({
  prefix,
  uploadKey,
  onUploadKeyChange,
  uploading,
  fileInputRef,
  onUploadFile,
}: {
  prefix: string
  uploadKey: string
  onUploadKeyChange: (value: string) => void
  uploading: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onUploadFile: (file: File, keyOverride?: string) => void
}) {
  return (
    <section className="space-y-2 rounded-md border border-line-control/60 px-3 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-tertiary">
        <Upload className="w-3.5 h-3.5" strokeWidth={1.8} />
        {t('Upload file')}
      </div>
      <input
        type="text"
        value={uploadKey}
        onChange={(event) => onUploadKeyChange(event.target.value)}
        spellCheck={false}
        className="w-full h-8 px-2.5 rounded-md border border-line-control/60 bg-surface text-[12px] font-mono text-main outline-none focus:border-line-focus"
        placeholder={`${prefix}SKILL.md`}
      />
      <p className="text-[11px] text-tertiary leading-relaxed">
        {t(
          'End the key with {slash} to append the chosen filename automatically, or type the full path (e.g. {example}).',
        )
          .split(/(\{slash\}|\{example\})/)
          .map((part, i) =>
            part === '{slash}' ? (
              <span key={i} className="font-mono">
                /
              </span>
            ) : part === '{example}' ? (
              <span key={i} className="font-mono">{`${prefix}SKILL.md`}</span>
            ) : (
              part
            ),
          )}
      </p>
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (!file) return
            let nextKey = uploadKey.trim()

            if (nextKey.endsWith('/')) {
              nextKey = `${nextKey}${file.name}`
              onUploadKeyChange(nextKey)
            }
            onUploadFile(file, nextKey)
          }}
        />
        <Button
          variant="secondary"
          className="h-8 text-[12px]"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? t('Uploading…') : t('Choose file')}
        </Button>
      </div>
    </section>
  )
}

export function SkillFilesSection({
  files,
  prefix,
  canDelete,
  onDeleteFile,
}: {
  files: TeamSkillObject[]
  prefix: string
  canDelete: boolean
  onDeleteFile: (key: string) => void
}) {
  return (
    <section className="space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('Files')}</div>
      {files.length === 0 ? (
        <p className="text-[12px] text-tertiary">{t('No files under this skill.')}</p>
      ) : (
        <div className="rounded-md border border-line-control/60 overflow-hidden">
          {files.map((file) => {
            const relative = file.key.slice(prefix.length) || file.key

            return (
              <div
                key={file.key}
                className="flex items-center gap-2 px-3 py-2 border-b border-line-control/40 last:border-b-0 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-main truncate" title={file.key}>
                    {relative}
                  </div>
                  <div className="text-[11px] text-tertiary">
                    {formatBytes(file.size)}
                    {file.lastModified ? (
                      <>
                        {' '}
                        · <Age value={file.lastModified} />
                      </>
                    ) : null}
                  </div>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onDeleteFile(file.key)}
                    className="h-7 w-7 rounded-md text-tertiary hover:text-status-danger hover:bg-state-hover flex items-center justify-center"
                    title={t('Delete {name}', { name: file.key })}
                    aria-label={t('Delete {name}', { name: file.key })}
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Provenance rows for a skill installed from GitHub, linking the folder at its commit. */
export function SkillOriginRow({ origin }: { origin: TeamSkillOrigin }) {
  return (
    <>
      <span className="text-tertiary">{t('Installed from')}</span>
      <a
        className={clsx(INLINE_LINK, 'truncate font-mono')}
        href={originUrl(origin)}
        target="_blank"
        rel="noreferrer"
        title={origin.commitSha}
      >
        {origin.repo}
        {origin.path ? `/${origin.path}` : ''} @ {origin.ref ?? origin.commitSha.slice(0, 7)}
      </a>
    </>
  )
}

/** Provenance row for a personal skill Sync my setup brings from a folder on this computer. */
export function SkillSyncedFromRow(props: { teamId: string; scope: SkillScope; name: string }) {
  const folder = useSyncedFrom(props.teamId, props.scope, props.name)

  if (!folder) return null

  return (
    <>
      <span className="text-tertiary">{t('Synced from')}</span>
      <span className="truncate font-mono text-secondary" title={folder}>
        {folder}
      </span>
    </>
  )
}
