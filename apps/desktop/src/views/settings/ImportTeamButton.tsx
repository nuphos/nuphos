import { useState } from 'react'

import { api } from '../../api'
import { AppAlertDialog } from '../../components/ui/alert-dialog'
import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { TeamImportPreview } from '../../types/team-migration'

export function ImportTeamButton() {
  const [preview, setPreview] = useState<TeamImportPreview | null>(null)
  const [sourceMember, setSourceMember] = useState('')
  const [busy, setBusy] = useState(false)

  async function choose() {
    setBusy(true)
    try {
      const next = await api.atlasPreviewTeamImport()

      setSourceMember('')
      setPreview(next)
    } catch (error) {
      toast.apiError(t('Could not import team data'), error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void choose()}>
        {busy ? t('Checking ZIP…') : t('Import ZIP into a new team')}
      </Button>
      <AppAlertDialog
        open={preview !== null}
        title={t('Import team data')}
        confirmLabel={t('Create imported team')}
        onClose={() => setPreview(null)}
        onConfirm={async () => {
          if (!preview) return
          await api.atlasConfirmTeamImport(preview.token, sourceMember || undefined)
          toast.success(t('Team imported. Select it from the team switcher.'))
        }}
        description={
          <span className="block space-y-3">
            <span className="block font-medium text-main">{preview?.name}</span>
            <span className="block">
              {t(
                'Import creates a new team with you as its only member. Invite teammates afterwards. Credentials and computers must be reconnected; triggers and scheduled refreshes stay disabled.',
              )}
            </span>
            <span className="block">
              {t(
                'Only import a ZIP you trust. Conversation text, instructions and scripts may contain secrets or unsafe content.',
              )}
            </span>
            <span className="block space-y-1">
              <span className="block">{t('Your identity in the archive')}</span>
              <AppSelect
                ariaLabel={t('Your identity in the archive')}
                className="w-full"
                positionerClassName="!z-[1100]"
                value={sourceMember}
                onValueChange={setSourceMember}
                options={[
                  { value: '', label: t('Keep all authors as historical identities') },
                  ...(preview?.members ?? []).map((member) => ({
                    value: member.sourceUserId,
                    label: member.email ? `${member.name} (${member.email})` : member.name,
                  })),
                ]}
              />
            </span>
            <span className="block max-h-32 overflow-y-auto text-[12px]">
              <span className="block font-medium">{t('Not migrated')}</span>
              {preview?.excluded.map((item, index) => (
                <span key={index} className="block">
                  {item.label ? `${item.label}: ` : ''}
                  {item.reason} — {item.nextAction}
                </span>
              ))}
            </span>
          </span>
        }
      />
    </>
  )
}
