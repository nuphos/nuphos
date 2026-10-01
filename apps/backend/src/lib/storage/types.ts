// Storage-provider boundary for the temporary file-transfer store. The default
// implementation is the Zeabur-owned S3 bucket; a future team-level BYOS S3
// plugs in behind the same interface without any route/agent changes. Providers
// only ever mint short-lived presigned URLs and delete objects — the backend is
// never in the file data path.

export type PresignedUrl = {
  url: string
  // Absolute expiry of the signed URL.
  expiresAt: Date
}

export type StorageObjectRef = {
  bucket: string
  region: string
  key: string
}

export type StorageObjectHead = {
  size: number
  contentType: string | null
}

export type StorageProvider = {
  // Stable key persisted on transfer records (e.g. 's3').
  readonly id: string
  // The bucket/region new objects are written to. Persisted per-item so
  // downloads survive a later provider switch.
  readonly bucket: string
  readonly region: string

  // Presigned PUT for a direct client→store upload.
  presignUpload(
    key: string,
    contentType: string | null,
    expiresInSeconds: number,
    size: number,
  ): Promise<PresignedUrl>

  // Presigned GET for a direct store→client download.
  presignDownload(
    ref: StorageObjectRef,
    downloadFileName: string,
    expiresInSeconds: number,
  ): Promise<PresignedUrl>

  // Confirm an object exists and read its real size/type (used at finalize).
  // Returns null when the object is absent.
  headObject(ref: StorageObjectRef): Promise<StorageObjectHead | null>

  // Best-effort delete (used when a transfer is cancelled/cleaned up; the
  // bucket lifecycle rule is the backstop).
  deleteObject(ref: StorageObjectRef): Promise<void>
}
