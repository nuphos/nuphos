import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Download, Link2, Users } from 'lucide-react'

import { Button } from '../../ui/button'
import { TitlebarDragSuspender } from '../ShareCard'

import { copyArtifactLink, downloadArtifact } from './artifactActions'
import { artifactFileName } from './artifactPayload'

import type { ArtifactVersion } from './artifactPayload'

const TRIGGER =
  'titlebar-no-drag relative flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-zGray-800 px-2 text-[12px] font-medium text-secondary outline-none transition-colors hover:bg-zGray-800/60 hover:text-main focus-visible:ring-2 focus-visible:ring-zViolet-accent data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main disabled:opacity-50'

/**
 * Share inside the team: a link that opens this version beside its chat for
 * anyone who can already see the chat, or a self-contained file to send
 * anywhere. Nothing is published; Nuphos hosts no public copy.
 */
export function ArtifactShareButton({
  current,
  link,
  iconOnly = false,
}: {
  current: ArtifactVersion
  link: string | null
  /** A narrow dock keeps the icon and drops the word. */
  iconOnly?: boolean
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={clsx(TRIGGER, iconOnly && 'w-7 justify-center px-0')}
        title="Share with your team"
      >
        <Users className="h-3.5 w-3.5" strokeWidth={1.8} />
        {iconOnly ? <span className="sr-only">Share</span> : 'Share'}
      </Popover.Trigger>
      <Popover.Portal>
        <TitlebarDragSuspender />
        <Popover.Positioner align="end" sideOffset={6} collisionPadding={12} className="z-[1000]">
          <Popover.Popup
            className={(popup) =>
              clsx(
                't-dropdown w-[320px] rounded-xl border border-zGray-800/60 bg-main p-3 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
                popup.open && 'is-open',
                popup.transitionStatus === 'ending' && 'is-closing',
              )
            }
            style={{ transformOrigin: 'top right' }}
          >
            <div className="mb-3 flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zGray-850 text-secondary">
                <Users className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <Popover.Title className="m-0 text-[13.5px] font-medium text-main">
                  Share with your team
                </Popover.Title>
                <Popover.Description className="m-0 text-[12px] leading-5 text-tertiary">
                  The link opens version {current.version} beside this chat, for teammates who can
                  already see it. Nothing is published to the web.
                </Popover.Description>
              </span>
            </div>
            <Button
              className="w-full"
              disabled={!link}
              onClick={() => link && void copyArtifactLink(link)}
            >
              <Link2 className="h-3.5 w-3.5" />
              {`Copy link to version ${String(current.version)}`}
            </Button>
            <div className="mt-3 border-t border-zGray-800/60 pt-3">
              <p className="m-0 mb-2 text-[12px] leading-5 text-tertiary">
                For anyone else, send the file. It opens anywhere and works offline.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-1 max-w-full"
                onClick={() => void downloadArtifact(current)}
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Download {artifactFileName(current)}</span>
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
