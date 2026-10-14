import { createContext, useContext } from 'react'

/** The full-height column beside the active page, under neither its toolbar nor its
 *  scroller, where a page can portal its own side panel. Null outside a main pane. */
export const PageAsideContext = createContext<HTMLElement | null>(null)

export function usePageAside(): HTMLElement | null {
  return useContext(PageAsideContext)
}
