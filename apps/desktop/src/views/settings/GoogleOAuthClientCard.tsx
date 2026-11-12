import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { LoadFailed } from './shared'
import { inputClasses } from './styles'
import { useAdminName } from './useAdminName'

import type { AtlasTeam } from '../../types'

export const GOOGLE_CLIENT_GUIDE_URL = 'https://docs.nuphos.ai/connectors/google-workspace'

// The team's own Google OAuth client, which members' Gmail and Google Drive
// Personal Credentials connect through. The secret is write-only. Where the
// deployment offers Composio (Nuphos Cloud), members can connect without one,
// so the client is optional until the team saves it.
export function GoogleOAuthClientCard({ team }: { team: AtlasTeam }) {
  const isAdmin = team.role === 'ADMINISTRATOR'
  const [savedClientId, setSavedClientId] = useState<string | null | undefined>(undefined)
  const [composio, setComposio] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const admin = useAdminName(team.id, !isAdmin)

  useEffect(() => {
    void api
      .atlasGetTeamGoogleClient(team.id)
      .then(({ clientId: id, composio: viaComposio }) => {
        setSavedClientId(id)
        setComposio(viaComposio)
        setClientId(id ?? '')
        setFailed(false)
      })
      // Not "not configured": an admin would otherwise overwrite a client they cannot see.
      .catch(() => setFailed(true))
  }, [team.id, attempt])

  async function save() {
    setSaving(true)
    try {
      await api.atlasSetTeamGoogleClient(team.id, clientId.trim(), clientSecret)
      setSavedClientId(clientId.trim())
      setClientSecret('')
      toast.success(t('Google OAuth client saved'))
    } catch (err) {
      toast.apiError(t('Could not save the Google OAuth client'), err)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    try {
      await api.atlasDeleteTeamGoogleClient(team.id)
      setSavedClientId(null)
      setClientId('')
      toast.success(t('Google OAuth client removed'))
    } catch (err) {
      toast.apiError(t('Could not remove the Google OAuth client'), err)
    } finally {
      setSaving(false)
    }
  }

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
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : isAdmin ? (
        <form
          className="space-y-3 rounded-lg border border-line-control/70 bg-surface px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input
            type="text"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
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
                onClick={() => void remove()}
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
