import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { useState } from 'react'
import { FolderPlus } from 'lucide-react'

import { api } from '../../api'
import { t } from '../../i18n'
import { addProject } from '../../lib/taskProjects'
import { Button } from '../ui/button'
import { Tooltip } from '../ui/tooltip'
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
  const [open, setOpen] = useState(false)
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
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tooltip
          content={t('Add a project folder')}
          trigger={<Popover.Trigger aria-label={t('Add project')} className={iconButton} />}
        >
          <FolderPlus className="h-3.5 w-3.5" strokeWidth={2} />
        </Tooltip>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-[1000]">
            <Popover.Popup
              className={(state) =>
                clsx(
                  't-dropdown w-72 rounded-xl border border-line-control bg-surface-raised p-4 shadow-xl outline-none',
                  state.open ? 'is-open' : 'is-closing',
                )
              }
            >
              <Popover.Title className="text-[13px] font-medium text-main">
                {t('Add project')}
              </Popover.Title>
              <Popover.Description className="mt-2 text-[12px] leading-relaxed text-secondary">
                {t(
                  'Group related tasks in a local folder. New tasks in the project use that folder when running on this computer.',
                )}
              </Popover.Description>
              <div className="mt-4 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    add()
                  }}
                >
                  {t('Choose folder')}
                </Button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  )
}
