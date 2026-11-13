export type SubmitEnv = {
  teamId: string
  onBound: () => void
  onClose: () => void
  /** Members chosen while connecting; absent keeps the team default. */
  shareList?: string[]
}
