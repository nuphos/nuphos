import { t } from '../../i18n'

/** A file an upload would send; `outside` ones come through a link out of the skill. */
export type ReviewFile = { relPath: string; realPath?: string; outside?: boolean }

/** A skill's files, one per line; an outside link shows where it really leads. */
export function SkillFileList({ files }: { files: readonly ReviewFile[] }) {
  return (
    <span className="block rounded-md border border-line-control px-2 py-1.5 font-mono text-[11.5px]">
      {files.map((file) => (
        <span key={file.relPath} className="block" title={file.realPath}>
          <span className="block truncate">{file.relPath}</span>
          {/* Wrapped, never truncated: this is the path the member is approving. */}
          {file.outside && file.realPath && (
            <span className="block break-all pl-3 text-warning">→ {file.realPath}</span>
          )}
        </span>
      ))}
    </span>
  )
}

function OutsideNote() {
  return (
    <span className="mt-2 block text-warning">
      {t(
        'Files with → come from outside this skill’s folder, at the path shown. Make sure you mean to share them.',
      )}
    </span>
  )
}

/** Every file an upload of one skill sends. */
export function SkillFilesReview({ files }: { files: readonly ReviewFile[] }) {
  return (
    <span className="block">
      <span className="block">{t('These files will be uploaded from this computer:')}</span>
      <span className="mt-2 block max-h-56 overflow-auto scrollbar-thin">
        <SkillFileList files={files} />
      </span>
      {files.some((file) => file.outside) && <OutsideNote />}
    </span>
  )
}

/** Every file of several skills, under each skill's name, for one confirm. */
export function SkillsFilesReview({
  skills,
}: {
  skills: readonly { id: string; name: string; files: readonly ReviewFile[] }[]
}) {
  return (
    <div className="text-[13px] text-secondary">
      <p>{t('These files will be uploaded from this computer:')}</p>
      <div className="mt-2 space-y-3">
        {skills.map((skill) => (
          <section key={skill.id}>
            <h3 className="mb-1 text-[12.5px] font-medium text-main">{skill.name}</h3>
            <SkillFileList files={skill.files} />
          </section>
        ))}
      </div>
      {skills.some((skill) => skill.files.some((file) => file.outside)) && <OutsideNote />}
    </div>
  )
}
