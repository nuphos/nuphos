import { ConfirmDialog } from '../../components/ConfirmDialog'

import { boxUpdateConfirm } from './boxRestartPresentation'

/** The card's "Update available" mark and the confirmation it and the menu's Update open. */
export function BoxHostUpdate({
  boxLabel,
  version,
  busy,
  confirming,
  onConfirmingChange,
  onUpdate,
}: {
  boxLabel: string
  version: string
  busy: boolean
  confirming: boolean
  onConfirmingChange: (open: boolean) => void
  onUpdate: () => void
}) {
  return (
    <>
      <button
        type="button"
        title={version ? `v${version} is available` : undefined}
        className="ml-auto shrink-0 rounded border border-zViolet-500/30 px-1.5 text-[10px] text-zViolet-400 hover:bg-zViolet-500/10"
        disabled={busy}
        onClick={() => onConfirmingChange(true)}
      >
        Update available
      </button>
      <ConfirmDialog
        open={confirming}
        {...boxUpdateConfirm(boxLabel, version || undefined)}
        onConfirm={onUpdate}
        onClose={() => onConfirmingChange(false)}
      />
    </>
  )
}
