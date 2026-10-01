import clsx from 'clsx'
import { Trash2, Upload } from 'lucide-react'

import { Age } from '../../components/Age'
import { VisibleErrorReporter } from '../../components/VisibleErrorReporter'
import { Button } from '../../components/ui/button'
import { formatBytes } from '../../grafana/format'

import type { TeamSkillHistory, TeamSkillObject } from '../../api'
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
      <div className="text-[11px] uppercase tracking-wide text-tertiary">History</div>
      <div className="overflow-hidden rounded-md border border-zGray-800/60">
        {events.slice(0, 20).map((event) => (
          <div key={event.id} className="border-b border-zGray-800/40 px-3 py-2 last:border-b-0">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-mono text-main">{event.action.replaceAll('_', ' ')}</span>
              <span
                className={clsx(
                  'font-mono text-[11px]',
                  event.status === 'applied'
                    ? 'text-emerald-400'
                    : event.status === 'failed' || event.status === 'partial'
                      ? 'text-red-400'
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
              {memberName(event.actorUserId)} via {event.source} · <Age value={event.createdAt} />
            </div>
            {event.error && (
              <div className="mt-1 line-clamp-2 text-[11px] text-red-300" title={event.error}>
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
    <section className="space-y-2 rounded-md border border-zGray-800/60 px-3 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-tertiary">
        <Upload className="w-3.5 h-3.5" strokeWidth={1.8} />
        Upload file
      </div>
      <input
        type="text"
        value={uploadKey}
        onChange={(event) => onUploadKeyChange(event.target.value)}
        spellCheck={false}
        className="w-full h-8 px-2.5 rounded-md border border-zGray-800/60 bg-field text-[12px] font-mono text-main outline-none focus:border-zViolet-500"
        placeholder={`${prefix}SKILL.md`}
      />
      <p className="text-[11px] text-tertiary leading-relaxed">
        End the key with <span className="font-mono">/</span> to append the chosen filename
        automatically, or type the full path (e.g.{' '}
        <span className="font-mono">{`${prefix}SKILL.md`}</span>).
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
          {uploading ? 'Uploading…' : 'Choose file'}
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
      <div className="text-[11px] uppercase tracking-wide text-tertiary">Files</div>
      {files.length === 0 ? (
        <p className="text-[12px] text-tertiary">No files under this skill.</p>
      ) : (
        <div className="rounded-md border border-zGray-800/60 overflow-hidden">
          {files.map((file) => {
            const relative = file.key.slice(prefix.length) || file.key

            return (
              <div
                key={file.key}
                className="flex items-center gap-2 px-3 py-2 border-b border-zGray-800/40 last:border-b-0 text-[12px]"
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
                    className="h-7 w-7 rounded-md text-tertiary hover:text-red-400 hover:bg-zGray-800 flex items-center justify-center"
                    title={`Delete ${file.key}`}
                    aria-label={`Delete ${file.key}`}
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
