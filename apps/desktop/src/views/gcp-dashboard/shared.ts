export type Props = {
  teamId: string
  projectId: string
  serviceAccountId?: string
  filter?: string
  refreshKey?: number
  onCount?: (count: number) => void
  onLoading?: (loading: boolean) => void
  onOpenAgentChat: (prompt: string, options?: { send?: boolean }) => void
}

export const RANGE_OPTIONS = [
  { minutes: 15, label: '15m' },
  { minutes: 60, label: '1h' },
  { minutes: 180, label: '3h' },
  { minutes: 720, label: '12h' },
  { minutes: 1440, label: '1d' },
] as const
export const FILTER_DEBOUNCE_MS = 350
