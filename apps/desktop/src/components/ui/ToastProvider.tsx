import { Toast } from '@base-ui/react/toast'
import {
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'

import { Button } from './button'
import { toastManager } from './toast'

import type { ToastType, ToastData } from './toast'
import type { ReactNode } from 'react'

const TONES = {
  error: { icon: faCircleExclamation, className: 'text-error' },
  success: { icon: faCircleCheck, className: 'text-success' },
  info: { icon: faCircleInfo, className: 'text-zBlue-accent' },
} as const

function ToastList() {
  const { toasts } = Toast.useToastManager()

  return (
    <Toast.Viewport className="fixed bottom-4 right-4 z-[2000] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none">
      {toasts.map((t) => {
        const type: ToastType = (t.type as ToastType) in TONES ? (t.type as ToastType) : 'info'
        const tone = TONES[type]
        const hasDescription = Boolean(t.description)

        return (
          <Toast.Root
            key={t.id}
            toast={t}
            className={clsx(
              'flex gap-3 rounded-lg border border-main bg-elevated p-3 shadow-lg shadow-black/20',
              // Top-align with the first line when there's a description, otherwise
              // center the single line so the title doesn't sit visually high.
              hasDescription ? 'items-start' : 'items-center',
              'transition-all duration-200 ease-out',
              'data-[starting-style]:translate-y-full data-[starting-style]:opacity-0',
              'data-[ending-style]:translate-y-full data-[ending-style]:opacity-0',
            )}
          >
            <FontAwesomeIcon
              icon={tone.icon}
              className={clsx(
                'flex-shrink-0 text-[15px]',
                hasDescription && 'mt-0.5',
                tone.className,
              )}
            />
            <div className="min-w-0 flex-1 selectable">
              <Toast.Title className="text-[13px] font-semibold text-main" />
              {hasDescription ? (
                // Clamped so a description built from user content (a chat
                // title, a pasted message) can't grow the toast unbounded.
                <Toast.Description className="mt-0.5 line-clamp-4 text-[12.5px] leading-relaxed text-secondary" />
              ) : null}
              {(t.data as ToastData | undefined)?.action ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    ;(t.data as ToastData).action?.onClick()
                    toastManager.close(t.id)
                  }}
                  className="mt-2 h-auto rounded px-1.5 py-[4px] text-[10px] font-medium leading-tight"
                >
                  {(t.data as ToastData).action?.label}
                </Button>
              ) : null}
            </div>
            <Toast.Close
              aria-label="Dismiss"
              className="flex-shrink-0 rounded p-0.5 text-[13px] text-tertiary transition-colors hover:text-main"
            >
              <FontAwesomeIcon icon={faXmark} />
            </Toast.Close>
          </Toast.Root>
        )
      })}
    </Toast.Viewport>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager} timeout={0} limit={3}>
      {children}
      <Toast.Portal>
        <ToastList />
      </Toast.Portal>
    </Toast.Provider>
  )
}
