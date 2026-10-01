import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { makeS3Client } from '@/lib/storage/s3-client'

import type { S3Client, _Object } from '@aws-sdk/client-s3'

export type SkillS3Object = {
  key: string
  etag: string
  size: number
  lastModified: Date | undefined
}

function normalizeEtag(etag: string | undefined): string {
  return (etag ?? '').replace(/^"|"$/g, '')
}

function toSkillObject(obj: _Object): SkillS3Object | null {
  if (!obj.Key || obj.Key.endsWith('/')) return null
  const etag = normalizeEtag(obj.ETag)

  if (!etag) return null

  return {
    key: obj.Key,
    etag,
    size: obj.Size ?? 0,
    lastModified: obj.LastModified,
  }
}

export class SkillsS3Client {
  readonly bucket: string
  private readonly client: S3Client

  private constructor(client: S3Client, bucket: string) {
    this.client = client
    this.bucket = bucket
  }

  static fromConfig(): SkillsS3Client {
    const { bucket, region, accessKeyId, secretAccessKey, endpoint } = config.skillsStore.s3

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new AppError(
        503,
        'skills_store_unconfigured',
        'Skills store is not configured on this server (set ATLAS_SKILLS_BUCKET and credentials)',
      )
    }

    return new SkillsS3Client(
      makeS3Client({
        region,
        accessKeyId,
        secretAccessKey,
        endpoint,
        requestChecksumCalculation: 'WHEN_REQUIRED',
      }),
      bucket,
    )
  }

  async listCommonPrefixes(prefix: string): Promise<string[]> {
    const out: string[] = []
    let continuationToken: string | undefined

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        }),
      )

      for (const entry of page.CommonPrefixes ?? []) {
        if (entry.Prefix) out.push(entry.Prefix)
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)

    return out
  }

  async listUnderPrefix(prefix: string): Promise<SkillS3Object[]> {
    const out: SkillS3Object[] = []
    let continuationToken: string | undefined

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      )

      for (const obj of page.Contents ?? []) {
        const mapped = toSkillObject(obj)

        if (mapped) out.push(mapped)
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)

    return out
  }

  async getObjectBody(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    )

    if (!out.Body) {
      throw new AppError(404, 'skill_object_not_found', `S3 object not found: ${key}`)
    }
    const bytes = await out.Body.transformToByteArray()

    return Buffer.from(bytes)
  }

  async headObject(key: string): Promise<{
    size: number
    etag: string
    contentType: string | null
    lastModified: Date | undefined
  } | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      )
      const etag = normalizeEtag(out.ETag)

      if (!etag) return null

      return {
        size: out.ContentLength ?? 0,
        etag,
        contentType: out.ContentType ?? null,
        lastModified: out.LastModified,
      }
    } catch (err: unknown) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async putObject(key: string, body: Buffer, contentType?: string | null): Promise<string> {
    const out = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    )

    return normalizeEtag(out.ETag)
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    })
  }
}

/**
 * Skills store backend resolution (hosted Mode 1 default).
 *
 * Today every caller gets the process-level Nuphos/self-host bucket from
 * `ATLAS_SKILLS_*`. `teamId` / `scope` are accepted so a future per-team BYOS
 * provider (Mode 3) can plug in without touching routes or agent tools — same
 * shape as `getStorageProvider(teamId?)` for file transfer.
 *
 * Callers should prefer this over `SkillsS3Client.fromConfig()` so the seam stays single.
 */
export function getSkillsStore(_opts?: { teamId?: string | null; scope?: string }): SkillsS3Client {
  return SkillsS3Client.fromConfig()
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string }).name
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode

  return name === 'NotFound' || name === 'NoSuchKey' || status === 404
}

export function isSkillsS3Configured(): boolean {
  const { bucket, accessKeyId, secretAccessKey } = config.skillsStore.s3

  return Boolean(bucket && accessKeyId && secretAccessKey)
}
