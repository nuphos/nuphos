import { GithubSkillInstallDialog } from './GithubSkillInstallDialog'
import { GithubSkillUpdatesDialog } from './GithubSkillUpdatesDialog'

import type { SkillScope } from '../../api'

/** The Skills toolbar's GitHub actions: check installed skills for updates, and install new ones. */
export function GithubSkillActions({
  teamId,
  scope,
  disabled,
  openSkill,
  onChanged,
}: {
  teamId: string
  scope: SkillScope
  disabled: boolean
  openSkill: string | null
  /** Reloads the list and the named skill's pane. */
  onChanged: (name: string | null) => void
}) {
  return (
    <>
      <GithubSkillUpdatesDialog
        teamId={teamId}
        scope={scope}
        disabled={disabled}
        onUpdated={() => onChanged(openSkill)}
      />
      <GithubSkillInstallDialog
        teamId={teamId}
        scope={scope}
        disabled={disabled}
        onInstalled={onChanged}
      />
    </>
  )
}
