import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { BindGithubDialog } from '../../../views/BindGithubDialog'
import { GithubMark } from '../../GithubMark'
import { Button } from '../../ui/button'

/** Under the home composer while the team has no GitHub: one step to the repos it can work on. */
export function HomeGithubButton({ teamId }: { teamId: string }) {
  // Unknown until read.
  const [bound, setBound] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true

    api
      .atlasListGithubInstallations(teamId)
      .then((installations) => {
        if (alive) setBound(installations.length > 0)
      })
      .catch(() => {
        // A failed read offers nothing rather than a step that may be done.
      })

    return () => {
      alive = false
    }
  }, [teamId])

  if (bound !== false) return null

  return (
    <div className="mt-3 flex justify-center">
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <GithubMark size={14} />
        {t('Connect GitHub')}
      </Button>
      <BindGithubDialog
        open={open}
        teamId={teamId}
        onClose={() => setOpen(false)}
        onBound={() => setBound(true)}
      />
    </div>
  )
}
