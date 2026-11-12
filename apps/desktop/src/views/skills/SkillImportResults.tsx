import clsx from 'clsx'
import { Check, MinusCircle, XCircle } from 'lucide-react'

import { t } from '../../i18n'

export type SkillImportResult = {
  id: string
  name: string
  status: 'imported' | 'skipped' | 'failed'
  /** What happened, in the member's words: file count, why skipped or failed. */
  detail: string
}

const ICONS = { imported: Check, skipped: MinusCircle, failed: XCircle }
const TONES = {
  imported: 'text-status-success',
  skipped: 'text-tertiary',
  failed: 'text-status-danger',
}

/** One row per skill after a bulk import, shared by every way of adding skills. */
export function SkillImportResults({ results }: { results: readonly SkillImportResult[] }) {
  const count = (status: SkillImportResult['status']) =>
    String(results.filter((result) => result.status === status).length)

  return (
    <div className="text-[13px] text-secondary">
      <p className="mb-2">
        {t('{imported} imported, {skipped} skipped, {failed} failed', {
          imported: count('imported'),
          skipped: count('skipped'),
          failed: count('failed'),
        })}
      </p>
      <ul className="space-y-1.5">
        {results.map((result) => {
          const Icon = ICONS[result.status]

          return (
            <li key={result.id} className="flex items-start gap-2">
              <Icon
                className={clsx('mt-0.5 h-3.5 w-3.5 flex-shrink-0', TONES[result.status])}
                strokeWidth={2}
              />
              <span className="min-w-0">
                <span className="font-mono text-[12px] text-main">{result.name}</span>
                <span className="block text-[12px] text-tertiary">{result.detail}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
