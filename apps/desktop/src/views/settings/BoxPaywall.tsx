import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'

import { Button } from '../../components/ui/button'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import { useOpenBilling } from './billing'
import { PlanCards } from './BillingNoPlan'
import { boxPaywall, boxPaywallLimitRead, paywallAudience } from './boxPaywallStore'
import { useBoxUsage } from './useBoxUsage'

import type { BoxPaywallRequest } from './boxPaywallStore'

const either = new Intl.ListFormat('en', { type: 'disjunction' })

function BoxPaywall({ request }: { request: BoxPaywallRequest }) {
  const members = useTeamMembers(request.teamId)
  const { isAdmin, admins } = paywallAudience(members, useCurrentUser()?.id)
  const { usage, watch } = useBoxUsage(request.teamId)
  const billing = useOpenBilling(request.teamId, watch)

  useEffect(() => {
    if (usage) boxPaywallLimitRead(usage.limitVcpus)
  }, [usage])
  const names = either.format(admins.map(memberDisplayName))
  // A team with a plan changes it in the billing portal; one without starts at Checkout.
  const opens = usage?.subscribed
    ? 'Your billing portal opens in your browser to change plans.'
    : 'Checkout opens in your browser.'
  const hint = isAdmin
    ? `${opens} ${request.afterPaid ?? 'Once you have paid, your Box starts here on its own.'}`
    : `Only team administrators can choose a plan. Ask ${names || 'a team administrator'} to upgrade.`

  return (
    <Dialog.Root open onOpenChange={(open) => !open && boxPaywall.close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1100] bg-black/40 backdrop-blur-sm transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[1101] w-[760px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900 shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0">
          <div className="flex items-start justify-between gap-4 border-b border-zGray-800 px-5 py-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-[15px] font-semibold text-main">
                Choose a Box plan
              </Dialog.Title>
              <Dialog.Description className="text-[13px] text-secondary">
                {request.message}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800 hover:text-main"
            >
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-5 py-4">
            <PlanCards
              billing={isAdmin ? billing : null}
              current={usage?.subscribed ? usage.limitVcpus : null}
              needs={request.needs}
            />
            <p className="text-[13px] text-tertiary">{hint}</p>
          </div>
          <div className="flex justify-end border-t border-zGray-800 px-5 py-3">
            <Button size="sm" variant="ghost" onClick={boxPaywall.close}>
              Not now
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The one Box paywall, mounted once at the app root and opened by `openBoxPaywall`. */
export function BoxPaywallHost() {
  const request = useSyncExternalStore(boxPaywall.subscribe, boxPaywall.current)

  return request ? <BoxPaywall key={request.id} request={request} /> : null
}
