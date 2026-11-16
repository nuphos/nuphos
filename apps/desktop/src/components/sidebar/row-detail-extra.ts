import { createContext } from 'react'

import type { ReactNode } from 'react'

/**
 * A chip the row adds to its own detail line, after the linked resources (a
 * done count beside the merged one). `key` changes whenever the chip's width
 * may, so the resource chips re-fit around it.
 */
export type RowDetailExtra = { key: string; node: ReactNode }

export const RowDetailExtraContext = createContext<RowDetailExtra | null>(null)
