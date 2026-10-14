import clsx from 'clsx'
import { ChevronRight, ExternalLink, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'

import { CloudLogo } from '../../components/CloudLogo'

import {
  githubAccountKind,
  githubConnectedSummary,
  githubInstallationSettingsUrl,
  githubRepoAccessLabel,
} from './github-installation-display'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { GithubInstallation } from '../../types'

type CursorPoint = { clientX: number; clientY: number }

function InstallationList({
  installations,
  onAddAnother,
}: {
  installations: GithubInstallation[]
  onAddAnother: () => void
}) {
  return (
    <div className="ml-12 mt-2 space-y-2">
      <ul className="divide-y divide-zGray-800/55 rounded-lg border border-zGray-800/55">
        {installations.map((installation) => {
          const settingsUrl = githubInstallationSettingsUrl(installation)

          return (
            <li key={installation.installationId} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-main">
                  {installation.accountLogin}
                </div>
                <div className="text-[11.5px] text-secondary/80">
                  {githubAccountKind(installation) === 'personal'
                    ? 'Personal account'
                    : 'Organization'}{' '}
                  · {githubRepoAccessLabel(installation)}
                </div>
              </div>
              {settingsUrl && (
                <a
                  href={settingsUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Change repository access on GitHub"
                  className="flex flex-none items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-tertiary transition-colors hover:bg-zGray-800 hover:text-main"
                >
                  GitHub
                  <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
                </a>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-[11.5px] leading-relaxed text-tertiary">
        Nuphos only sees repositories in these accounts. To use an organization&apos;s repositories,
        an owner of that organization has to install the app on it.{' '}
        <button
          type="button"
          onClick={onAddAnother}
          className="text-zViolet-accent hover:underline"
        >
          Install on another account
        </button>
      </p>
    </div>
  )
}

/** The GitHub catalog card once the app is installed on at least one account. */
export function GithubConnectorCard({
  name,
  installations,
  installed,
  onAddAnother,
  onOpenGroup,
  onContextMenu,
}: {
  name: string
  installations: GithubInstallation[]
  installed: IntegrationPlatformRow[]
  onAddAnother: () => void
  onOpenGroup: (rows: IntegrationPlatformRow[], event: CursorPoint) => void
  onContextMenu: (row: IntegrationPlatformRow, event: CursorPoint) => void
}) {
  const [open, setOpen] = useState(false)
  const summary = githubConnectedSummary(installations)
  const first = installed[0]
  const manage = (point: CursorPoint) => {
    if (installed.length > 1) onOpenGroup(installed, point)
    else first.onAction?.()
  }
  const openMenu = (point: CursorPoint) => {
    if (installed.length > 1) onOpenGroup(installed, point)
    else onContextMenu(first, point)
  }

  return (
    <div
      className="group min-w-0 rounded-lg px-1.5 py-3"
      onContextMenu={(event) => {
        event.preventDefault()
        openMenu(event)
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-zGray-800/55 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <CloudLogo provider="github" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-main">{name}</div>
          <button
            type="button"
            aria-expanded={open}
            title={summary}
            onClick={() => setOpen((value) => !value)}
            className="mt-0.5 flex max-w-full items-start gap-1 text-left text-[12px] leading-4 text-secondary/80 transition-colors hover:text-main"
          >
            <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-success" />
            <span className="line-clamp-2 min-w-0 break-words">{summary}</span>
            <ChevronRight
              className={clsx(
                'mb-px h-3.5 w-3.5 flex-none self-end transition-transform',
                open && 'rotate-90',
              )}
              strokeWidth={1.8}
            />
          </button>
        </div>
        <button
          type="button"
          onClick={(event) => manage(event)}
          className="flex-none rounded-lg border border-zGray-750 bg-zGray-900 px-3 py-1 text-[12px] font-medium text-secondary transition-colors hover:border-zGray-650 hover:bg-zGray-850 hover:text-main"
        >
          Manage
        </button>
        <button
          type="button"
          aria-label={`More ${name} actions`}
          title={`More ${name} actions`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()

            openMenu({ clientX: rect.right, clientY: rect.bottom })
          }}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-tertiary opacity-0 transition-colors hover:bg-zGray-800 hover:text-main group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      {open && <InstallationList installations={installations} onAddAnother={onAddAnother} />}
    </div>
  )
}
