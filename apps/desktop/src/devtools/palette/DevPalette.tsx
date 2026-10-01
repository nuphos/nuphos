import { useEffect } from 'react'

import { useTheme } from '../../hooks/useTheme'

import { reapplyForTheme } from './overrides'
import { PalettePanel } from './PalettePanel'

// Always mounted in dev, so it also owns applying saved overrides on boot and
// re-applying the correct set on theme flips.
export function DevPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { resolved } = useTheme()

  useEffect(() => {
    reapplyForTheme(resolved)
  }, [resolved])

  return open ? <PalettePanel onClose={onClose} /> : null
}
