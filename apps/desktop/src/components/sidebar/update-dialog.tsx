import { AlertDialog } from '@base-ui/react/alert-dialog'

import { t } from '../../i18n'
import { Button } from '../ui/button'

/** Asks before the restart that installs an update, so a click never quits the app by surprise. */
export function UpdateDialog({
  version,
  open,
  onClose,
  onUpdate,
}: {
  version: string
  open: boolean
  onClose: () => void
  onUpdate: () => void
}) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-[1001] w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-line-control bg-surface-sheet p-6 shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <AlertDialog.Title className="text-[17px] font-semibold text-main">
            {t('Update ready')}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[14px] leading-relaxed text-secondary">
            {t(
              'Restart to finish installing Nuphos {version}. Agents on this computer stop, so replies still running there are cut off.',
              { version },
            )}
          </AlertDialog.Description>
          <div className="mt-6 grid grid-cols-2 gap-2.5">
            <AlertDialog.Close
              render={<Button type="button" variant="secondary" className="rounded-full" />}
            >
              {t('Not now')}
            </AlertDialog.Close>
            <Button
              type="button"
              className="rounded-full"
              onClick={() => {
                onUpdate()
                onClose()
              }}
            >
              {t('Update')}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
