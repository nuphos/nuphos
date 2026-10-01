import type { PanelSnapshotErrorKind } from '@/models'

export class PanelExecError extends Error {
  constructor(
    public kind: PanelSnapshotErrorKind,
    message: string,
    /** A transient runtime condition worth one more attempt. */
    public retryable = false,
  ) {
    super(message)
    this.name = 'PanelExecError'
  }
}
