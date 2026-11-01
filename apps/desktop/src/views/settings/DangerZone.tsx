import { useState } from 'react'

import { api } from '../../api'
import { AppAlertDialog } from '../../components/ui/alert-dialog'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { AtlasTeam } from '../../types'

// Owners disband the workspace; everyone else leaves it.
export function DangerZone({
  team,
  onTeamRemoved,
}: {
  team: AtlasTeam
  onTeamRemoved: (teamId: string) => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const canDelete = Boolean(team.isOwner)

  const teamName = team.name || t('this workspace')

  // Failures surface through the global toast (never inline under the button),
  // so we catch here rather than letting the dialog render the error itself.
  async function confirmAction() {
    try {
      if (canDelete) {
        await api.atlasDeleteTeam(team.id)
        toast.success(t('Workspace deleted'))
      } else {
        await api.atlasLeaveTeam(team.id)
        toast.success(t('Left workspace'))
      }
      onTeamRemoved(team.id)
    } catch (err) {
      setConfirmOpen(false)
      toast.apiError(
        canDelete ? t('Could not delete workspace') : t('Could not leave workspace'),
        err,
      )
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-error/25 bg-error/[0.04] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-main">
            {canDelete ? t('Delete workspace') : t('Leave workspace')}
          </div>
          {/* The 30-day retention/recovery copy states the announced policy;
              the purge job + support recovery/export that back it are not built
              yet. Keep this wording in sync when that ships. */}
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-tertiary">
            {canDelete
              ? t(
                  'Deletes this workspace for every member. Data is kept for 30 days, then permanently destroyed.',
                )
              : t("You'll lose access until someone invites you back.")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="h-9 flex-shrink-0 rounded-md border border-error/40 px-3 text-[13px] font-medium text-error transition-colors hover:bg-error/10"
        >
          {canDelete ? t('Delete') : t('Leave')}
        </button>
      </div>

      <AppAlertDialog
        open={confirmOpen}
        destructive
        title={canDelete ? t('Delete workspace') : t('Leave workspace')}
        description={
          canDelete
            ? t(
                'Delete {name}? The workspace is removed for every member. Its data is kept for 30 days, then permanently destroyed — within that window you can contact support to recover or export it.',
                { name: teamName },
              )
            : t(
                "Leave {name}? You'll lose access to this workspace until someone invites you back.",
                { name: teamName },
              )
        }
        confirmLabel={canDelete ? t('Delete workspace') : t('Leave workspace')}
        onConfirm={confirmAction}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  )
}
