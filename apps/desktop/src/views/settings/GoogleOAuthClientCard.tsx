import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { useTeamGoogleClientQuery } from '../../lib/query/account'
import { queryKeys } from '../../lib/query/keys'

import { LoadFailed } from './shared'
import { inputClasses } from './styles'
import { useAdminName } from './useAdminName'

import type { AtlasTeam, TeamGoogleClient } from '../../types'

export const GOOGLE_CLIENT_GUIDE_URL = 'https://docs.nuphos.ai/connectors/google-workspace'

// The team's own Google OAuth client, which members' Gmail and Google Drive
// Personal Credentials connect through. The secret is write-only. Where the
// deployment offers Composio (Nuphos Cloud), members can connect without one,
// so the client is optional until the team saves it.
export function GoogleOAuthClientCard({ team }: { team: AtlasTeam }) {
  const isAdmin = team.role === 'ADMINISTRATOR'
  const queryClient = useQueryClient()
  const loaded = useTeamGoogleClientQuery(team.id)
  const savedClientId = loaded.data?.clientId
  const composio = loaded.data?.composio ?? false
  // What the admin typed; until then the field shows the saved client.
  const [draftId, setDraftId] = useState<string>()
  const clientId = draftId ?? savedClientId ?? ''
  const [clientSecret, setClientSecret] = useState('')
  // Not "not configured" on a failed read: an admin would otherwise overwrite a client they cannot see.
  const failed = loaded.isError
  const admin = useAdminName(team.id, !isAdmin)
  const saved = (id: string | null) => {
    queryClient.setQueryData<TeamGoogleClient>(queryKeys.teamGoogleClient(team.id), (previous) =>
      previous ? { ...previous, clientId: id } : previous,
    )
    setDraftId(undefined)
    setClientSecret('')
  }
  const save = useMutation({
    mutationFn: (id: string) => api.atlasSetTeamGoogleClient(team.id, id, clientSecret),
    onSuccess: (_result, id) => {
      saved(id)
      toast.success(t('Google OAuth client saved'))
    },
    onError: (err) => toast.apiError(t('Could not save the Google OAuth client'), err),
  })
  const remove = useMutation({
    mutationFn: () => api.atlasDeleteTeamGoogleClient(team.id),
    onSuccess: () => {
      saved(null)
      toast.success(t('Google OAuth client removed'))
    },
    onError: (err) => toast.apiError(t('Could not remove the Google OAuth client'), err),
  })
  const saving = save.isPending || remove.isPending

  const optional = composio && savedClientId === null

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-main">
          {t('Google OAuth client')}
          {optional && isAdmin && (
            <span className="ml-2 text-[12px] font-normal text-tertiary">{t('Optional')}</span>
          )}
        </h2>
        <p className="mt-1 text-[13px] text-tertiary">
          {optional
            ? t(
                'Members can connect Gmail and Google Drive in Personal Credentials through Composio. Add your own Google Cloud OAuth client to connect through it instead.',
              )
            : t(
                'Members connect Gmail and Google Drive through your own Google Cloud OAuth client.',
              )}{' '}
          <button
            type="button"
            className="text-link hover:underline"
            onClick={() => void api.appOpenExternal(GOOGLE_CLIENT_GUIDE_URL)}
          >
            {t('Setup guide')}
          </button>
        </p>
      </div>

      {failed ? (
        <LoadFailed
          message={t('Couldn’t load the Google OAuth client.')}
          onRetry={() => void loaded.refetch()}
        />
      ) : isAdmin ? (
        <form
          className="space-y-3 rounded-lg border border-line-control/70 bg-surface px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(clientId.trim())
          }}
        >
          <input
            type="text"
            required
            value={clientId}
            onChange={(e) => setDraftId(e.target.value)}
            placeholder={t('Client ID (…apps.googleusercontent.com)')}
            aria-label={t('Client ID')}
            className={inputClasses}
          />
          <input
            type="password"
            required
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={
              savedClientId
                ? t('Client secret (saved, enter a new one to replace)')
                : t('Client secret')
            }
            aria-label={t('Client secret')}
            autoComplete="off"
            className={inputClasses}
          />
          <div className="flex justify-end gap-2">
            {savedClientId && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => remove.mutate()}
              >
                {t('Remove')}
              </Button>
            )}
            <Button size="sm" type="submit" disabled={saving || !clientId.trim() || !clientSecret}>
              {saving ? t('Saving…') : t('Save')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="rounded-lg border border-line-control/70 bg-surface px-4 py-3.5 text-[12.5px] text-secondary">
          {savedClientId === undefined
            ? '—'
            : savedClientId
              ? t('Configured. Connect Gmail or Google Drive in Personal Credentials.')
              : composio
                ? t('Not required. Connect Gmail or Google Drive in Personal Credentials.')
                : admin
                  ? t('Not configured. Ask {name} to add one.', { name: admin })
                  : t('Not configured. Ask a workspace administrator to add one.')}
        </div>
      )}
    </div>
  )
}
