import type { Collection, ObjectId } from 'mongodb'

import { db } from '@/lib/db'

// --- Architecture diagrams ---------------------------------------------------

export type DiagramNode = {
  id: string
  label: string
  kind?: string
  // Absolute position (top-left). All nodes are flat / absolute — there is no
  // parent nesting. A node is "inside" a group purely by geometry.
  position: { x: number; y: number }
  // Present => this node IS a group: a labelled rectangle of this explicit size.
  // Whether other nodes belong to it is decided geometrically (their box inside
  // this rect), not stored. Absent => a regular node (default 200x72).
  size?: { width: number; height: number }
  // Present => CONCRETE node bound to a real resource/page; absent => ABSTRACT.
  // Aligns with the app's page URL schema (https://nuphos.ai/teams/<id>/infra/…)
  // so a double-click navigates in-app; any other URL opens in the browser. The
  // url also drives the node's kind/colour — concrete nodes have no resource tag.
  url?: string
}

export type DiagramEdge = {
  id: string
  source: string
  target: string
  label?: string
  // Perpendicular offset of the edge's middle (orthogonal) segment from its
  // auto-centred default, set by dragging the segment handle. 0/absent = auto.
  offset?: number
}

export type NodeStyle = {
  hidden?: boolean
  color?: string
}

export type DiagramView = {
  id: string
  name: string
  edges: DiagramEdge[]
  nodeStyles?: Record<string, NodeStyle>
}

export type ArchitectureDiagram = {
  _id: ObjectId
  teamId: ObjectId
  name: string
  nodes: DiagramNode[]
  views: DiagramView[]
  createdAt: Date
  updatedAt: Date
}

export const architectureDiagrams = (): Collection<ArchitectureDiagram> =>
  db().collection<ArchitectureDiagram>('architecture_diagrams')

// ---------- File transfer ----------
//
// A short-lived bidirectional file-transfer store. A *group* is the logical
// unit the UI shows (1..N files); a single file is just a group of one. Each
// file is its own S3 object with its own presigned URL. Both group and item
// records carry `expiresAt` with a Mongo TTL index, so stale metadata is
// reaped independently of the S3 lifecycle rule — and entirely independently
// of the agent sandbox lifecycle (no transfer ever extends a sandbox lease).

export type FileTransferDirection = 'upload' | 'download'
// upload   = user → store (agent later pulls into a sandbox/cluster)
// download = store → user (agent/remote produced it, user fetches it)

export type FileTransferGroupStatus =
  | 'pending' // intents issued, awaiting object writes
  | 'ready' // all files written and finalized
  | 'partial' // some files written, others failed/expired
  | 'failed'
  | 'expired'

export type FileTransferItemStatus =
  | 'pending' // presigned URL issued, object not yet confirmed
  | 'ready' // object present and finalized
  | 'failed'
  | 'expired'

export type FileTransferGroup = {
  _id: ObjectId
  teamId: ObjectId
  userId: string
  // The agent conversation/session this transfer belongs to, when created in
  // an agent context. Absent for team-level transfers.
  sessionId?: string
  direction: FileTransferDirection
  status: FileTransferGroupStatus
  // Which StorageProvider holds the objects ('s3' = Zeabur default). Stored
  // so downloads keep working even if the team later switches providers.
  storageProvider: string
  // Optional human label for the whole group (e.g. used as the zip name).
  label?: string
  createdAt: Date
  expiresAt: Date
}

export type FileTransferItem = {
  _id: ObjectId
  groupId: ObjectId
  teamId: ObjectId
  fileName: string
  // Relative path within the group, preserved so a directory export can be
  // re-zipped with its structure intact. Defaults to fileName.
  relPath?: string
  declaredSize: number
  // Confirmed object size after finalize (S3 HEAD), when known.
  actualSize?: number
  contentType: string | null
  storageProvider: string
  bucket: string
  region: string
  objectKey: string
  status: FileTransferItemStatus
  createdAt: Date
  finalizedAt?: Date
  expiresAt: Date
}

export const fileTransferGroups = (): Collection<FileTransferGroup> =>
  db().collection<FileTransferGroup>('file_transfer_groups')

export const fileTransferItems = (): Collection<FileTransferItem> =>
  db().collection<FileTransferItem>('file_transfer_items')

// Shared operational counters, independent of subscription or payment state.
export type FileTransferAdmission = {
  _id: string
  count: number
  bytes: number
  expiresAt: Date
}

export const fileTransferAdmissions = (): Collection<FileTransferAdmission> =>
  db().collection<FileTransferAdmission>('file_transfer_admissions')
