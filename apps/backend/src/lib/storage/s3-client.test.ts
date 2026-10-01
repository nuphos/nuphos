// The contract that matters here is the shape of the presigned URL: every
// uploader (sandbox curl, Electron PUT, mobile) gets one of these and nothing
// else, so if the host or the bucket addressing is wrong the whole transfer
// path is wrong.

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { describe, expect, test } from 'bun:test'

import { makeS3Client } from './s3-client'

const CREDENTIALS = {
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret-example',
}

function presign(client: ReturnType<typeof makeS3Client>): Promise<string> {
  return getSignedUrl(client, new PutObjectCommand({ Bucket: 'transfers', Key: 'a/b.txt' }), {
    expiresIn: 60,
  })
}

describe('makeS3Client', () => {
  test('without an endpoint, signs AWS virtual-hosted URLs', async () => {
    const url = new URL(
      await presign(
        makeS3Client({
          region: 'us-west-1',
          ...CREDENTIALS,
          endpoint: undefined,
          requestChecksumCalculation: 'WHEN_REQUIRED',
        }),
      ),
    )

    expect(url.hostname).toBe('transfers.s3.us-west-1.amazonaws.com')
    expect(url.pathname).toBe('/a/b.txt')
  })

  test('with an endpoint, signs path-style URLs on that host', async () => {
    const url = new URL(
      await presign(
        makeS3Client({
          region: 'us-east-1',
          ...CREDENTIALS,
          endpoint: 'https://files.example.com',
          requestChecksumCalculation: 'WHEN_REQUIRED',
        }),
      ),
    )

    expect(url.hostname).toBe('files.example.com')
    // Path style: the bucket is the first path segment, not a DNS label. A
    // self-hosted store has no per-bucket DNS, so virtual-hosted would 404.
    expect(url.pathname).toBe('/transfers/a/b.txt')
  })

  test('leaves the SDK checksum default alone when not asked to override it', async () => {
    // The journal sealer writes Object-Lock/WORM segments through the SDK and
    // never presigns, so it must keep the SDK's own checksum behaviour rather
    // than inherit the presigning stores' WHEN_REQUIRED.
    const client = makeS3Client({
      region: 'us-east-1',
      ...CREDENTIALS,
      endpoint: undefined,
      requestChecksumCalculation: undefined,
    })
    const resolved = client.config.requestChecksumCalculation
    const value = typeof resolved === 'function' ? await resolved() : resolved

    expect(value).toBe('WHEN_SUPPORTED')
  })

  test('presigned URLs carry no checksum query params', async () => {
    // WHEN_REQUIRED keeps x-amz-checksum-* out of the signature; otherwise every
    // uploader would have to send a matching checksum header or be rejected.
    const url = new URL(
      await presign(
        makeS3Client({
          region: 'us-east-1',
          ...CREDENTIALS,
          endpoint: 'https://files.example.com',
          requestChecksumCalculation: 'WHEN_REQUIRED',
        }),
      ),
    )
    const params = [...url.searchParams.keys()]

    expect(params.filter((p) => p.startsWith('x-amz-checksum'))).toEqual([])
    expect(params).toContain('X-Amz-Signature')
  })
})
