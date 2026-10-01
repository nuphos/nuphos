import type { ReactNode } from 'react'

export type BreadcrumbOption = {
  key: string
  label: string
  sublabel?: string
  selected?: boolean
  group?: string
  icon?: ReactNode
  onPick: () => void
}

export type BreadcrumbSegment = {
  label: string
  icon?: ReactNode
  loading?: boolean
  options?: BreadcrumbOption[]
  emptyText?: string
  onExpand?: () => void
  onClick?: () => void
  /**
   * Marks a segment as a specific resource instance (an account, cluster, pod,
   * role, bucket, …) rather than a navigable page/list. The Toolbar shows these
   * normally; the sidebar back-hierarchy tree filters them out so it reflects
   * the page path, not resource attributes.
   */
  isResource?: boolean
}
