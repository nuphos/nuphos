import { Button as BaseButton } from '@base-ui/react/button'
import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Check, ChevronsUpDown, Loader2, Mail, X } from 'lucide-react'
import { useState } from 'react'

import { Menu, MenuContent, MenuTrigger } from '../ui/menu'
import { toast } from '../ui/toast'
import { renderWorkspaceMenuOptions } from '../WorkspaceMenuOptions'

import type { Scope, TeamInvitation } from '../../types'
import type { BreadcrumbSegment } from '../Toolbar'

export function SidebarIdentitySelector({
  scope,
  segment,
}: {
  scope: Scope
  segment: BreadcrumbSegment
}) {
  if (scope.kind !== 'aws-account' && scope.kind !== 'gcp-project') return null

  const isAws = scope.kind === 'aws-account'
  const title = isAws ? 'AWS role' : 'GCP service account'
  const hint = isAws
    ? 'You have multiple available roles to view and operate this AWS account.'
    : 'You have multiple available service accounts to view and operate this GCP project.'

  return (
    <div className="mb-2.5">
      <div className="mb-1.5 px-1">
        <div className="text-[11px] uppercase tracking-wider text-tertiary font-medium">
          {title}
        </div>
        <div className="mt-0.5 text-[11.5px] leading-snug text-tertiary">{hint}</div>
      </div>
      <Menu
        onOpenChange={(open) => {
          if (open) segment.onExpand?.()
        }}
      >
        <MenuTrigger className="w-full h-9 flex items-center gap-2.5 px-2.5 rounded-md text-[13px] transition-colors outline-none ring-0 focus-visible:bg-[var(--sidebar-overlay-focus)] hover:bg-[var(--sidebar-overlay-hover)] text-main data-[popup-open]:bg-[var(--sidebar-overlay-active)]">
          {segment.loading ? (
            <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-zViolet-accent" />
          ) : (
            <span className="flex items-center flex-shrink-0 [&>*]:!h-[18px] [&>*]:!w-[18px] [&>svg]:!h-[18px] [&>svg]:!w-[18px]">
              {segment.icon}
            </span>
          )}
          <span className="truncate flex-1 text-left font-medium">{segment.label}</span>
          {!segment.loading && (
            <ChevronsUpDown className="w-3.5 h-3.5 flex-shrink-0 text-tertiary" />
          )}
        </MenuTrigger>
        <MenuContent side="top" align="start" className="w-[260px] max-h-[360px]">
          {segment.options && segment.options.length > 0 ? (
            renderWorkspaceMenuOptions(segment.options)
          ) : (
            <div className="px-2.5 py-2 text-tertiary text-[12.5px]">
              {segment.emptyText || 'No identities'}
            </div>
          )}
        </MenuContent>
      </Menu>
    </div>
  )
}

/**
 * Bottom-left pending-invitations affordance: a small circular email button
 * that, when pending invitations exist, expands a panel with Accept/Reject for
 * each. The panel scales open from the button's bottom-left corner via the
 * shared `t-dropdown` animation (data-origin="bottom-left").
 */
export function SidebarInvitations({
  invitations,
  onAccept,
  onReject,
}: {
  invitations: TeamInvitation[]
  onAccept?: (invitationId: string) => Promise<unknown>
  onReject?: (invitationId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const count = invitations.length

  async function act(invitationId: string, handler?: (id: string) => Promise<unknown>) {
    if (!handler || actingId !== null) return
    setActingId(invitationId)
    try {
      await handler(invitationId)
    } catch (err) {
      toast.apiError('Invitation action failed', err)
    } finally {
      setActingId(null)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="titlebar-no-drag relative flex h-7 w-7 items-center justify-center rounded-full border border-zGray-800/60 bg-main/50 text-tertiary outline-none backdrop-blur-md transition-colors hover:bg-main/70 hover:text-secondary data-[popup-open]:bg-main/70 data-[popup-open]:text-secondary"
        aria-label={count === 1 ? '1 team invitation' : `${String(count)} team invitations`}
        title={count === 1 ? '1 team invitation' : `${String(count)} team invitations`}
      >
        <Mail className="h-3.5 w-3.5" strokeWidth={2} />
        <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-semibold leading-none text-white">
          {count}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-[1000]">
          <Popover.Popup
            className={(state) =>
              clsx(
                't-dropdown w-[264px] overflow-hidden rounded-lg border border-zGray-800/60 bg-main shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] outline-none',
                state.open && 'is-open',
                state.transitionStatus === 'ending' && 'is-closing',
              )
            }
            style={{ transformOrigin: 'bottom left' }}
          >
            <div className="flex items-center gap-2 px-2 pt-2 pb-1">
              <Mail className="h-3.5 w-3.5 flex-shrink-0 text-tertiary" strokeWidth={2} />
              <span className="text-[12.5px] font-semibold text-main">
                {count === 1 ? 'Team invitation' : `${String(count)} team invitations`}
              </span>
            </div>
            <div className="max-h-[320px] space-y-1 overflow-y-auto scrollbar-thin p-0.5">
              {invitations.map((invitation) => (
                <div key={invitation.id} className="rounded-md bg-zGray-850 px-2.5 py-2">
                  <div className="truncate text-[12.5px] text-main">
                    {invitation.team?.name ?? 'Team invitation'}
                  </div>
                  <div className="truncate text-[11.5px] text-tertiary">
                    {invitation.inviteeEmail}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <BaseButton
                      disabled={actingId !== null}
                      onClick={() => void act(invitation.id, onAccept)}
                      className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-zViolet-500 px-2 text-[12px] font-medium text-white outline-none transition-colors hover:bg-zViolet-400 data-[disabled]:cursor-default data-[disabled]:opacity-60"
                    >
                      <Check className="h-3 w-3" />
                      Accept
                    </BaseButton>
                    <BaseButton
                      disabled={actingId !== null}
                      onClick={() => void act(invitation.id, onReject)}
                      className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-zGray-700 px-2 text-[12px] font-medium text-secondary outline-none transition-colors hover:bg-zGray-800/70 hover:text-main data-[disabled]:cursor-default data-[disabled]:opacity-60"
                    >
                      <X className="h-3 w-3" />
                      Reject
                    </BaseButton>
                  </div>
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function SidebarSectionSkeleton() {
  return (
    <div className="space-y-1 px-2.5 py-1">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-8 flex items-center gap-3">
          <div className="h-4 w-4 flex-shrink-0 rounded bg-zGray-800/80 animate-pulse" />
          <div className="h-3 flex-1 rounded bg-zGray-800/65 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
