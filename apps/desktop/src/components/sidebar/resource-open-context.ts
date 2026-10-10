import { createContext } from 'react'

export const ResourceOpenContext = createContext<
  ((href: string, label: string, newTab: boolean) => void) | undefined
>(undefined)
