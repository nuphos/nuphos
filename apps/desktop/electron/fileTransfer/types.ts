export type CreatedFile = {
  id: string
  fileName: string
  relPath: string
  uploadUrl: string
}
export type CreatedTransfer = {
  groupId: string
  direction: string
  status: string
  expiresAt: string
  files: CreatedFile[]
}
export type ResolvedFile = {
  id: string
  fileName: string
  relPath: string
  size: number | null
  contentType: string | null
  status: string
  downloadUrl?: string
}
export type TransferGroup = {
  groupId: string
  direction: string
  status: string
  label: string | null
  files: ResolvedFile[]
  // True when the selection was packed into a single .zip for transport so the
  // agent knows to pull-and-extract it (folder / multi-file uploads).
  archive?: boolean
  archiveEntryCount?: number
}

export type LocalEntry = {
  path: string
  relPath: string
  fileName: string
  size: number
  contentType: string | null
}

/** Internal create/finalize transport; capabilities never enter a tool result. */
export type PostTransfer = <T>(
  teamId: string,
  sessionId: string | undefined,
  suffix: string,
  body?: unknown,
) => Promise<T>
