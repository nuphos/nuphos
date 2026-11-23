import { CheckCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { iconButton } from '../../components/sidebar/project-actions'
import { toast } from '../../components/ui/toast'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'

import { dismissQuestions } from './dismissAll'
import { setDismissAllAsking, useInboxSearch } from './inboxSelection'

import type { InboxQuestion } from './inboxItems'

/** Dismisses `questions` at once. Those refused come back in the list, and a toast counts them. */
function dismissAll(teamId: string, questions: readonly InboxQuestion[]) {
  dismissQuestions(teamId, questions, ({ failed, reason }) => {
    if (failed.length === 1) toast.error(t('Could not dismiss question'), reason)
    else if (failed.length > 1)
      toast.error(t('Could not dismiss {n} questions', { n: failed.length }))
  })
}

type Props = {
  teamId: string
  /** The questions the sidebar's list shows. */
  questions: readonly InboxQuestion[]
}

/**
 * "Dismiss all" at the right of the sidebar's Inbox header, for the questions its list shows:
 * with a search on the Inbox page, only the matches. Hidden while the list is empty.
 */
export function DismissAllButton(props: Props) {
  // Emptied meanwhile, as when they were answered in a chat, it goes, and stops asking.
  return props.questions.length > 0 ? <DismissAll {...props} /> : null
}

/** It asks first, and the Inbox's keys rest meanwhile. */
function DismissAll({ teamId, questions }: Props) {
  const [confirming, setConfirming] = useState(false)
  const searching = useInboxSearch(teamId).trim() !== ''
  const count = questions.length

  useEffect(() => {
    setDismissAllAsking(teamId, confirming)

    return () => setDismissAllAsking(teamId, false)
  }, [teamId, confirming])

  return (
    <>
      <Tooltip
        content={t('Dismiss all')}
        trigger={
          <button
            type="button"
            aria-label={t('Dismiss all')}
            onClick={() => setConfirming(true)}
            className={`ml-auto ${iconButton}`}
          />
        }
      >
        <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} />
      </Tooltip>
      <ConfirmDialog
        open={confirming}
        title={
          searching
            ? count === 1
              ? t('Dismiss 1 matching question?')
              : t('Dismiss {n} matching questions?', { n: count })
            : count === 1
              ? t('Dismiss 1 question?')
              : t('Dismiss {n} questions?', { n: count })
        }
        description={t("Each Bot or Task that asked is told you won't answer.")}
        confirmLabel={t('Dismiss all')}
        onConfirm={() => dismissAll(teamId, questions)}
        onClose={() => setConfirming(false)}
      />
    </>
  )
}
