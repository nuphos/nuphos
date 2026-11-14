import { useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Switch } from '../../components/ui/Switch'
import { t } from '../../i18n'

/** Owner only: lets those who only use the computer open a terminal, after a warning. */
export function BoxTerminalAccess({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const label = t('Allow members with Use access to open a terminal')

  return (
    <>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-line-control px-3 py-2.5 text-[12.5px] text-main">
        {label}
        <Switch
          checked={checked}
          disabled={disabled}
          label={label}
          onChange={(next) => (next ? setConfirming(true) : onChange(false))}
        />
      </label>
      <ConfirmDialog
        open={confirming}
        title={t('Allow terminals for Use access?')}
        description={t(
          "Members with Use access will be able to open a terminal on this computer. A terminal can read the computer's files, including the agent's sign-in, and act as the signed-in account.",
        )}
        confirmLabel={t('Allow')}
        onConfirm={() => onChange(true)}
        onClose={() => setConfirming(false)}
      />
    </>
  )
}
