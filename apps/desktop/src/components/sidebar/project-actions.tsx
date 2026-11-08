import { FolderPlus } from 'lucide-react'

import { api } from '../../api'
import { t } from '../../i18n'
import { addProject } from '../../lib/taskProjects'
import { toast } from '../ui/toast'

import type { ReactNode } from 'react'

const iconButton =
  'inline-flex h-5 w-5 items-center justify-center rounded text-tertiary hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary'

export function RowButton({
  label,
  onPress,
  children,
}: {
  label: string
  onPress: () => void
  children: ReactNode
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onPress()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onPress()
      }}
      className={iconButton}
    >
      {children}
    </span>
  )
}

/** Beside Tasks: pick a folder on this computer to work in. */
export function AddProjectButton({ teamId }: { teamId: string }) {
  const add = () => {
    api.selectLocalFolder().then(
      (paths) => {
        for (const path of paths) addProject(teamId, path)
      },
      (err: unknown) => toast.apiError(t('Could not open folder picker'), err),
    )
  }

  return (
    <span className="ml-auto">
      <RowButton label={t('Add project')} onPress={add}>
        <FolderPlus className="h-3.5 w-3.5" strokeWidth={2} />
      </RowButton>
    </span>
  )
}
