// Zeabur-owned S3 implementation of StorageProvider. Uses a dedicated static
// credential pair scoped to the transfer bucket — NOT the BYOS connector role
// (that assumes customer roles for customer buckets).

import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { makeS3Client } from './s3-client'

import type { PresignedUrl, StorageObjectHead, StorageObjectRef, StorageProvider } from './types'
import type { S3Client } from '@aws-sdk/client-s3'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

// RFC 5987 / content-disposition filename encoding so non-ASCII names round
// trip to the browser/Finder without corrupting the header.
function contentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(fileName)

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

export class S3StorageProvider implements StorageProvider {
  readonly id = 's3'
  readonly bucket: string
  readonly region: string
  private readonly client: S3Client

  private constructor(client: S3Client, bucket: string, region: string) {
    this.client = client
    this.bucket = bucket
    this.region = region
  }

  // Throws a clear 503 when the transfer store isn't configured rather than
  // failing deep inside the AWS SDK.
  static fromConfig(): S3StorageProvider {
    const { bucket, region, accessKeyId, secretAccessKey, endpoint } = config.fileTransfer.s3

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new AppError(
        503,
        'file_transfer_unconfigured',
        'File transfer storage is not configured on this server',
      )
    }

    return new S3StorageProvider(
      makeS3Client({
        region,
        accessKeyId,
        secretAccessKey,
        endpoint,
        requestChecksumCalculation: 'WHEN_REQUIRED',
      }),
      bucket,
      region,
    )
  }

  async presignUpload(
    key: string,
    contentType: string | null,
    expiresInSeconds: number,
    size: number,
  ): Promise<PresignedUrl> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentLength: size,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
      { expiresIn: expiresInSeconds, signableHeaders: new Set(['content-length']) },
    )

    return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) }
  }

  async presignDownload(
    ref: StorageObjectRef,
    downloadFileName: string,
    expiresInSeconds: number,
  ): Promise<PresignedUrl> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: ref.bucket,
        Key: ref.key,
        ResponseContentDisposition: contentDisposition(downloadFileName),
      }),
      { expiresIn: expiresInSeconds },
    )

    return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) }
  }

  async headObject(ref: StorageObjectRef): Promise<StorageObjectHead | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
      )

      return {
        size: out.ContentLength ?? 0,
        contentType: out.ContentType ?? null,
      }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async deleteObject(ref: StorageObjectRef): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: ref.bucket, Key: ref.key }))
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }

  return e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404
}
