import { t } from '../../i18n'

import type { LocalSkillInfo } from '../../api'

/** Every file an upload sends; one reached through a link out of the skill shows where it really is. */
export function SkillFilesReview({ files }: { files: LocalSkillInfo['files'] }) {
  const outside = files.some((file) => file.outside)

  return (
    <span className="block">
      <span className="block">{t('These files will be uploaded from this computer:')}</span>
      <span className="mt-2 block max-h-56 overflow-auto rounded-md border border-line-control px-2 py-1.5 font-mono text-[11.5px] scrollbar-thin">
        {files.map((file) => (
          <span key={file.relPath} className="block truncate" title={file.realPath}>
            {file.relPath}
            {file.outside && <span className="text-warning"> → {file.realPath}</span>}
          </span>
        ))}
      </span>
      {outside && (
        <span className="mt-2 block text-warning">
          {t(
            'Files with → come from outside this skill’s folder, at the path shown. Make sure you mean to share them.',
          )}
        </span>
      )}
    </span>
  )
}
