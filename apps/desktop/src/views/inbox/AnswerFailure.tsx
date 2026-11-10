import { CircleAlert } from 'lucide-react'

import { t } from '../../i18n'

/** On a question's card: its answer could not be sent, so the question is still open. */
export function AnswerFailure({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-[12px] leading-5 text-error">
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        {t('Could not send the message')}
        {message && <span className="text-error/90"> · {message}</span>}
      </span>
    </p>
  )
}
