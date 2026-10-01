import clsx from 'clsx'
import { Minus, X } from 'lucide-react'
import { useCallback, useState } from 'react'

// A one-shot promo card docked at the bottom of the sidebar, shown once the
// first-run onboarding checklist is gone (the team has cloud infra connected)
// but the team has no Slack workspace bound yet. Connecting Slack unmounts it
// via the parent gate; dismissing hides it per-team forever; minimizing keeps
// a compact one-row version of the same card.
//
// Per-team state (dismissed/collapsed) is seeded once from localStorage on
// mount, so the parent must remount this via a `key={teamId}` when the team
// changes.

const DISMISS_KEY = (teamId: string) => `nuphos.slack-promo.dismissed.${teamId}`
const COLLAPSE_KEY = (teamId: string) => `nuphos.slack-promo.collapsed.${teamId}`

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable — the promo just won't remember; harmless.
  }
}

function readPersisted(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function SidebarSlackPromo({
  teamId,
  onConnect,
}: {
  teamId: string
  onConnect: () => void
}) {
  const [dismissed, setDismissed] = useState(() => readPersisted(DISMISS_KEY(teamId)))
  const [collapsed, setCollapsed] = useState(() => readPersisted(COLLAPSE_KEY(teamId)))

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    persist(DISMISS_KEY(teamId), '1')
  }, [teamId])

  const setCollapsedPersisted = useCallback(
    (next: boolean) => {
      setCollapsed(next)
      persist(COLLAPSE_KEY(teamId), next ? '1' : '0')
    },
    [teamId],
  )

  if (dismissed) return null

  return (
    <div className="px-1 pt-1 pb-2 titlebar-no-drag">
      <div className="relative overflow-hidden rounded-lg rounded-bl-xl bg-[#1249B6]">
        {/* Expanded content — artwork + pitch; height animates away when
            minimized, leaving the compact row on the same blue card. */}
        <div
          aria-hidden={collapsed}
          className={clsx(
            'grid transition-[grid-template-rows] duration-300 ease-in-out',
            collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
          )}
        >
          <div
            className={clsx(
              'min-h-0 overflow-hidden transition-opacity duration-300',
              collapsed && 'opacity-0',
            )}
          >
            {/* The artwork shares the card's blue, so it reads as one surface. */}
            <img
              src="/connect-to-slack.png"
              alt=""
              draggable={false}
              className="block w-full select-none"
            />
            <div className="px-2.5 pb-2.5 pt-1">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-white">
                <span>Connect to</span>
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-white">
                  <img src="/slack.svg" alt="" draggable={false} className="h-3 w-3 select-none" />
                </span>
                <span>Slack</span>
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-white/75">
                Chat with the agent and get updates right in your Slack workspace.
              </p>
              <button
                type="button"
                disabled={collapsed}
                onClick={onConnect}
                className="mt-2 flex h-7 w-full items-center justify-center rounded-md bg-[#007A5A] text-[12px] font-medium text-white transition-opacity hover:opacity-90"
              >
                Connect
              </button>
            </div>
          </div>
        </div>

        {/* Minimize + dismiss, floating over the artwork's top-right corner. */}
        <div
          aria-hidden={collapsed}
          className={clsx(
            'absolute right-1.5 top-1.5 flex items-center gap-0.5 transition-opacity duration-300',
            collapsed && 'pointer-events-none opacity-0',
          )}
        >
          <button
            type="button"
            disabled={collapsed}
            onClick={() => setCollapsedPersisted(true)}
            title="Minimize"
            aria-label="Minimize Slack promo"
            className="flex h-5 w-5 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Minus className="h-3 w-3" strokeWidth={2} />
          </button>
          <button
            type="button"
            disabled={collapsed}
            onClick={handleDismiss}
            title="Dismiss"
            aria-label="Dismiss Slack promo"
            className="flex h-5 w-5 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>

        {/* Minimized row — white Slack tile + title expand the card back;
            Connect keeps working without expanding. */}
        <div
          aria-hidden={!collapsed}
          className={clsx(
            'grid transition-[grid-template-rows] duration-300 ease-in-out',
            collapsed ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div
            className={clsx(
              'min-h-0 overflow-hidden transition-opacity duration-300',
              !collapsed && 'opacity-0',
            )}
          >
            <div className="flex items-center gap-2 p-2">
              <button
                type="button"
                disabled={!collapsed}
                onClick={() => setCollapsedPersisted(false)}
                aria-label="Expand Slack promo"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-white">
                  <img
                    src="/slack.svg"
                    alt=""
                    draggable={false}
                    className="h-3.5 w-3.5 select-none"
                  />
                </span>
                <span className="truncate text-[12px] font-medium text-white">
                  Connect to Slack
                </span>
              </button>
              <button
                type="button"
                disabled={!collapsed}
                onClick={onConnect}
                className="h-6 flex-shrink-0 rounded-md bg-[#007A5A] px-2.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
