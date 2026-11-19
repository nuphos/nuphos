import { t } from '../../i18n'

/** Marks an agent provider that is still a preview upstream. */
export function PreviewTag() {
  return (
    <span className="ml-1.5 shrink-0 rounded border border-line-control px-1 text-[10px] uppercase tracking-wide text-tertiary">
      {t('Preview')}
    </span>
  )
}
