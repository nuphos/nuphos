import { createContext } from 'react'

/** A layout supplies the outer frame and title; nested groups keep their own titles. */
export const SummaryLayoutTitle = createContext<string | null>(null)

/** Header actions stay mounted with their content while rendering beside the handle. */
export const SummaryLayoutActions = createContext<{
  target: HTMLElement | null
  onAction: () => void
} | null>(null)
