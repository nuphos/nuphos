import { faApple, faWindows } from '@fortawesome/free-brands-svg-icons'
import {
  faBatteryThreeQuarters,
  faMagnifyingGlass,
  faWifi,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { ChevronUp, Folder, Globe, Search, Volume2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CloudLogo } from '../../../components/CloudLogo'

import type { OnboardingStagePlatform } from './shared'

// The Slack pitch, acted out: a mini desktop (light theme, the real live-demo
// wallpaper) where a Slack notification slides in the moment the stage
// appears — and stays put. Two OS skins share the beat: macOS (transparent
// menu bar, frosted banner under the top-right corner) and Windows 11
// (acrylic centered taskbar, toast above the bottom-right tray). Decorative
// (aria-hidden); the chat lines above carry the message.
export function SlackAlertStage({
  reduce,
  platform,
}: {
  reduce: boolean
  platform: OnboardingStagePlatform
}) {
  // Slides in once, right after mount, and never leaves.
  const [shown, setShown] = useState(reduce)

  useEffect(() => {
    // Reduced motion: shown statically from the start.
    if (reduce) return
    const t = window.setTimeout(() => setShown(true), 450)

    return () => window.clearTimeout(t)
  }, [reduce])

  const notif = reduce || shown
  const isWin = platform === 'windows'

  return (
    <div>
      <div
        aria-hidden
        className="relative overflow-hidden rounded-xl border border-zGray-800/70"
        style={{ aspectRatio: '16 / 7' }}
      >
        {/* The desktop is 150% of the viewport wide and anchored to the right
            edge — a zoomed crop of the corner where the notification lands,
            so the system chrome and the notification share one scale instead
            of the whole desktop being miniaturized. */}
        <div className="absolute inset-y-0 right-0 w-[150%]">
          {/* Desktop wallpaper — the real live-demo wallpaper asset. */}
          <img
            src="/livedemo-wallpaper.png"
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover"
          />

          {isWin ? (
            <>
              {/* Windows 11 taskbar — light acrylic, centered icons, tray on
                  the right with stacked clock/date. */}
              <div
                className="absolute inset-x-0 bottom-0 flex h-9 items-center border-t border-white/40 px-3 backdrop-blur-xl backdrop-saturate-150"
                style={{ backgroundColor: 'rgba(243,243,243,0.72)' }}
              >
                <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3">
                  <FontAwesomeIcon icon={faWindows} className="text-[15px] text-[#0078D4]" />
                  <Search className="h-[14px] w-[14px] text-black/70" strokeWidth={2} />
                  <Folder className="h-[14px] w-[14px] text-[#F8B117]" strokeWidth={2} />
                  <Globe className="h-[14px] w-[14px] text-[#0078D4]" strokeWidth={2} />
                  <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-white shadow-sm">
                    <CloudLogo provider="slack" size={14} />
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-2 text-black/75">
                  <ChevronUp className="h-[12px] w-[12px]" strokeWidth={2} />
                  <FontAwesomeIcon icon={faWifi} className="text-[9px]" />
                  <Volume2 className="h-[12px] w-[12px]" strokeWidth={2} />
                  <FontAwesomeIcon icon={faBatteryThreeQuarters} className="text-[9px]" />
                  <span className="text-right text-[8px] leading-[1.35]">
                    9:41 AM
                    <br />
                    7/15/2026
                  </span>
                </div>
              </div>

              {/* Windows 11 toast — acrylic card above the tray, app-name
                  header row with a close ×, then icon + title + body. */}
              <div
                className={clsx(
                  'absolute bottom-11 right-3 w-[42%] rounded-lg border border-black/[0.06] p-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  notif ? 'translate-x-0 opacity-100' : 'translate-x-[115%] opacity-0',
                )}
                style={{ backgroundColor: 'rgba(249,249,249,0.7)' }}
              >
                <div className="flex items-center gap-1.5">
                  <CloudLogo provider="slack" size={12} />
                  <span className="text-[9.5px] text-black/60">Slack</span>
                  <span className="flex-1" />
                  <X className="h-[11px] w-[11px] text-black/40" strokeWidth={2} />
                </div>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[8px] bg-white shadow-sm ring-1 ring-black/[0.06]">
                    <CloudLogo provider="slack" size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold text-black/90">
                      Nuphos · #ops
                    </div>
                    <div className="truncate text-[10.5px] leading-snug text-black/60">
                      🚨 CPU spike on prod-cluster (94%) — I&apos;m investigating.
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* macOS menu bar —  · bold app name · menus | status. Modern
                  macOS draws it fully transparent over the wallpaper (no
                  blur), with white items. The left menus live on the cropped
                  part of the desktop; the visible slice shows the status
                  area, like a real zoom onto the top-right corner. */}
              <div className="absolute inset-x-0 top-0 flex h-7 items-center justify-between px-3 text-[11.5px] text-white/90">
                <div className="flex items-center gap-3">
                  <FontAwesomeIcon icon={faApple} className="text-[13px] text-white" />
                  <span className="font-semibold text-white">Nuphos</span>
                  <span>File</span>
                  <span>Edit</span>
                  <span>View</span>
                  <span>Window</span>
                  <span>Help</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <FontAwesomeIcon icon={faBatteryThreeQuarters} className="text-[11px]" />
                  <FontAwesomeIcon icon={faWifi} className="text-[10px]" />
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="text-[10px]" />
                  <span>Wed Jul 15</span>
                  <span>9:41 AM</span>
                </div>
              </div>

              {/* Slack notification — macOS style (light): frosted card
                  sliding in under the menu bar, app icon left, title/body,
                  timestamp. */}
              <div
                className={clsx(
                  'absolute right-3 top-10 flex w-[42%] items-center gap-2.5 rounded-[14px] border border-white/40 p-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  notif ? 'translate-x-0 opacity-100' : 'translate-x-[115%] opacity-0',
                )}
                style={{ backgroundColor: 'rgba(246,246,246,0.55)' }}
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] bg-white shadow-sm ring-1 ring-black/[0.06]">
                  <CloudLogo provider="slack" size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1">
                    <span className="truncate text-[11px] font-semibold text-black/90">Slack</span>
                    <span className="ml-auto flex-shrink-0 text-[9.5px] text-black/40">now</span>
                  </div>
                  <div className="truncate text-[10.5px] font-medium text-black/75">
                    Nuphos · #ops
                  </div>
                  <div className="truncate text-[10.5px] leading-snug text-black/60">
                    🚨 CPU spike on prod-cluster (94%) — I&apos;m investigating.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-tertiary">
        The moment something breaks, the alert comes to you — no dashboard-watching required.
      </p>
    </div>
  )
}
