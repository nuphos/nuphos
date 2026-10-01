import type { SkillMetadataDTO, SkillMutationActor } from '../metadata'

export const SKILL_OBJECT_KEY_PREFIX = 'skills/'
export const MAX_SKILL_UPLOAD_BYTES = 10_000_000
export const MAX_SKILL_LIST_OBJECTS = 5_000
export const MAX_SKILL_TEXT_BYTES = 200_000
export const SKILL_PRESIGN_EXPIRY_SECONDS = 900

export type SkillObject = {
  key: string
  size: number
  etag: string
  lastModified?: string
}

export type SkillMutationContext = {
  /** Stable across retries of the same logical mutation. */
  mutationId?: string
  actor: SkillMutationActor
}

export type SkillObjectWrite = {
  key: string
  body: Buffer
  contentType?: string | null
}

export type SkillObjectsResponse = {
  scope: string
  objects: SkillObject[]
  truncated: boolean
  limit: number
}

export type SkillObjectDetailResponse = {
  scope: string
  key: string
  size: number
  etag: string
  contentType: string | null
  lastModified: string | null
  presignedUrl: string
  text: string | null
  textTruncated: boolean
}

export type SkillSummary = {
  name: string
  displayName: string
  description: string | null
  fileCount: number
  hasSkillMd: boolean
  totalBytes: number
  lastModified: string | null
  metadata: SkillMetadataDTO
}

export type SkillManifestResponse = {
  scope: string
  skills: SkillSummary[]
  orphans: SkillObject[]
  truncated: boolean
  limit: number
}

export type DeleteSkillResult = {
  name: string
  deletedCount: number
  keys: string[]
}
