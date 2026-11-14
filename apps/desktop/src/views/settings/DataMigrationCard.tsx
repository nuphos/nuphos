import { useState } from 'react'

import { api } from '../../api'
import { AppAlertDialog } from '../../components/ui/alert-dialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { ImportTeamButton } from './ImportTeamButton'

import type { AtlasTeam } from '../../types'

export function DataMigrationCard({ team }: { team: AtlasTeam }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    setConfirmOpen(false)
    try {
      if (await api.atlasExportTeam(team.id)) toast.success(t('Team ZIP saved'))
    } catch (error) {
      toast.apiError(t('Could not export team data'), error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-10 space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-main">{t('Data migration')}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-tertiary">
          {t(
            'Download team settings, knowledge, conversation text and work items as a ZIP. Credentials, running sessions and files are excluded. A reconnect checklist is included.',
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {team.role === 'ADMINISTRATOR' && (
          <Button size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>
            {busy ? t('Exporting…') : t('Export ZIP')}
          </Button>
        )}
        <ImportTeamButton />
      </div>
      <AppAlertDialog
        open={confirmOpen}
        title={t('Export team data')}
        description={t(
          'This ZIP contains private team conversations and knowledge. Text and scripts may include secrets pasted by members. Store it securely. Import always creates a new team; accounts and computers must be reconnected.',
        )}
        confirmLabel={t('Export ZIP')}
        onConfirm={download}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  )
}
