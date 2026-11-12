/**
 * Per-PR session routing as stored on Triggers created before binding was
 * required. Nothing routes on it any more; binding a Trigger clears it.
 */
export type SessionRouting = {
  keyTemplate: string
  github?: {
    installationId: number
    repositoryId: number
    actions: ('opened' | 'reopened' | 'synchronize' | 'ready_for_review' | 'labeled')[]
    label?: string
  }
}
