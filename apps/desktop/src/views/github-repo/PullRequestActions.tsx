import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type {
  GithubCliResult,
  GithubCliViewer,
  GithubMergeMethod,
  GithubPRDetail,
  GithubPullRef,
} from '../../types'

const MERGE_METHODS = [
  { value: 'squash', label: t('Squash and merge') },
  { value: 'merge', label: t('Create a merge commit') },
  { value: 'rebase', label: t('Rebase and merge') },
]

// Writes go through the user's own `gh` login, never the Nuphos GitHub App, so
// GitHub records them as that person. Without a login the controls stay off.
export function PullRequestActions({
  pull,
  pullRef,
  onChanged,
}: {
  pull: GithubPRDetail
  pullRef: GithubPullRef
  onChanged: () => void
}) {
  // undefined while checking, null when gh is missing or signed out.
  const [viewer, setViewer] = useState<GithubCliViewer | null | undefined>(undefined)
  const [body, setBody] = useState('')
  const [method, setMethod] = useState<GithubMergeMethod>('squash')
  const [busy, setBusy] = useState(false)

  const loadViewer = useCallback(
    () => api.githubCliViewer().then(setViewer, () => setViewer(null)),
    [],
  )

  useEffect(() => {
    void loadViewer()
  }, [loadViewer])

  const run = async (done: string, failed: string, action: () => Promise<GithubCliResult>) => {
    setBusy(true)
    try {
      const result = await action()

      if (result.ok) {
        setBody('')
        toast.success(done)
        onChanged()
      } else {
        toast.error(failed, result.message)
      }
    } catch (err) {
      toast.apiError(failed, err)
    } finally {
      setBusy(false)
    }
  }

  const disabled = !viewer || busy
  const isAuthor = viewer?.login === pull.author
  const open = pull.state === 'open' && !pull.merged
  const [actingBefore, actingAfter] = t('Acting as {login} through your GitHub CLI').split(
    '{login}',
  )

  return (
    <section className="divide-y divide-zGray-800/70 overflow-hidden rounded-lg border border-zGray-800/80 bg-zGray-900/50">
      <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-tertiary">
        {viewer ? (
          <>
            <Avatar src={viewer.avatarUrl} name={viewer.login} size={20} className="rounded-full" />
            <span className="min-w-0 truncate">
              {actingBefore}
              <span className="font-medium text-main">{viewer.login}</span>
              {actingAfter}
            </span>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              {viewer === undefined
                ? t('Checking your GitHub CLI login…')
                : t(
                    'Install the GitHub CLI and run `gh auth login` to comment, review or merge from here.',
                  )}
            </span>
            {viewer === null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setViewer(undefined)
                  void loadViewer()
                }}
              >
                {t('Check again')}
              </Button>
            )}
          </>
        )}
      </div>

      <div className="space-y-2 p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={disabled}
          placeholder={t('Leave a comment')}
          rows={4}
          className="w-full resize-y rounded-md border border-zGray-800 bg-zGray-850 px-2.5 py-1.5 text-[12.5px] text-main outline-none transition-colors placeholder:text-quaternary focus:border-zGray-600 disabled:opacity-50"
        />
        <div className="flex flex-wrap justify-end gap-2">
          {!isAuthor && open && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled || !body.trim()}
                onClick={() =>
                  void run(t('Changes requested'), t('Review not submitted'), () =>
                    api.githubCliReview(pullRef, 'REQUEST_CHANGES', body),
                  )
                }
              >
                {t('Request changes')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void run(t('Pull request approved'), t('Review not submitted'), () =>
                    api.githubCliReview(pullRef, 'APPROVE', body),
                  )
                }
              >
                {t('Approve')}
              </Button>
            </>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={disabled || !body.trim()}
            onClick={() =>
              void run(t('Comment posted'), t('Comment not posted'), () =>
                api.githubCliComment(pullRef, body),
              )
            }
          >
            {t('Comment')}
          </Button>
        </div>
      </div>

      {open && !pull.draft && (
        <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2">
          <AppSelect
            value={method}
            onValueChange={(value) => setMethod(value as GithubMergeMethod)}
            options={MERGE_METHODS}
            disabled={disabled}
            ariaLabel={t('Merge method')}
            className="w-48"
            triggerClassName="h-8"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={disabled}
            onClick={() =>
              void run(t('Pull request merged'), t('Merge not completed'), () =>
                api.githubCliMerge(pullRef, method),
              )
            }
          >
            {t('Merge')}
          </Button>
        </div>
      )}
    </section>
  )
}
