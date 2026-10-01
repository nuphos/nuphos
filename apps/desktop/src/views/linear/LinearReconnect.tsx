import { useState } from 'react'

import { LinearMark } from '../../components/LinearMark'
import { Button } from '../../components/ui/button'
import { BindLinearDialog } from '../BindLinearDialog'

export const LINEAR_RECONNECT_REQUIRED = 'linear_reconnect_required'

type Props = {
  teamId: string
  onReconnected: () => void
  className?: string
}

export function LinearReconnectPrompt({ teamId, onReconnected, className }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className={className ?? 'flex flex-col items-center gap-3 text-center'}>
      <div className="text-[12.5px] text-secondary">
        Linear authorization expired or was revoked. Reconnect Linear to keep using it.
      </div>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <LinearMark size={14} />
        Reconnect Linear
      </Button>
      {open && (
        <BindLinearDialog
          open
          teamId={teamId}
          onClose={() => setOpen(false)}
          onBound={() => {
            setOpen(false)
            onReconnected()
          }}
        />
      )}
    </div>
  )
}
