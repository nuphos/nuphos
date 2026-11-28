import { t } from '../../i18n'

import type { Answered } from './runtimeLogin'

/** The answers so far, one row each; Change starts the sign-in over, as a CLI cannot step back. */
export function AnsweredRows({ rows, onChange }: { rows: Answered[]; onChange: () => void }) {
  return rows.map((row, index) => (
    <div
      key={index}
      className="flex items-center gap-3 rounded-lg bg-state-selected px-3 py-2 text-[13px]"
    >
      <span className="w-2/5 shrink-0 truncate text-tertiary" title={row.question}>
        {row.question}
      </span>
      <span className="min-w-0 flex-1 truncate text-main">{row.answer}</span>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 text-xs text-secondary hover:text-main hover:underline"
      >
        {t('Change')}
      </button>
    </div>
  ))
}
