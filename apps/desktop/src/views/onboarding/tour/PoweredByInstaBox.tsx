import { Dialog } from '@base-ui/react/dialog'
import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../../i18n'

/** "Powered by InstaBox"; its name opens a short note on what InstaBox is, as on iOS. */
export function PoweredByInstaBox({ onOpen }: { onOpen: (url: string) => void }) {
  const [before, after] = t('Powered by {brand}', { brand: '\u0001' }).split('\u0001')
  const [open, setOpen] = useState(false)

  return (
    <p className="text-[12px] text-tertiary">
      {before}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-medium text-secondary underline-offset-2 hover:underline"
      >
        InstaBox
      </button>
      {after}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[998] bg-black/40" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-[999] flex w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col items-start gap-3.5 rounded-xl border border-line-control bg-surface-sheet p-6 text-left text-main shadow-2xl shadow-black/30 outline-none">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-[9px] bg-black">
                <img src="/instabox-mark.svg" alt="" className="size-[18px] brightness-0 invert" />
              </span>
              <Dialog.Title className="text-[20px] font-bold">InstaBox</Dialog.Title>
            </div>
            <Dialog.Description className="text-[14px] leading-6 text-secondary">
              {t(
                'InstaBox runs computers. Your Nuphos computer is one of them, so your Bots keep their files and tools in one place and keep working when your laptop is closed.',
              )}
            </Dialog.Description>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onOpen('https://instabox.sh')
              }}
              className="flex items-center gap-1 text-[14px] font-semibold text-primary hover:underline"
            >
              {t('Visit instabox.sh')}
              <ArrowUpRight className="size-4" />
            </button>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </p>
  )
}
