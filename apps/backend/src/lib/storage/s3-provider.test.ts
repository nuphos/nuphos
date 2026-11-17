import { expect, test } from 'bun:test'

import { S3StorageProvider } from './s3-provider'

import { config } from '@/config'

test('upload signature binds Content-Length to the declared size', async () => {
  const original = config.fileTransfer.s3

  config.fileTransfer.s3 = {
    bucket: 'test-transfers',
    region: 'us-east-1',
    accessKeyId: 'test',
    secretAccessKey: 'test-secret',
    endpoint: undefined,
    publicEndpoint: undefined,
  }
  try {
    const provider = S3StorageProvider.fromConfig()
    const first = new URL((await provider.presignUpload('object', null, 60, 100)).url)
    const second = new URL((await provider.presignUpload('object', null, 60, 101)).url)

    expect(first.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('content-length')
    expect(first.searchParams.get('X-Amz-Signature')).not.toBe(
      second.searchParams.get('X-Amz-Signature'),
    )
  } finally {
    config.fileTransfer.s3 = original
  }
})

test('presigned URLs use the public endpoint when one is set', async () => {
  const original = config.fileTransfer.s3

  config.fileTransfer.s3 = {
    bucket: 'test-transfers',
    region: 'us-east-1',
    accessKeyId: 'test',
    secretAccessKey: 'test-secret',
    endpoint: 'http://rustfs:9000',
    publicEndpoint: 'http://storage.example.test:9000',
  }
  try {
    const provider = S3StorageProvider.fromConfig()
    const upload = new URL((await provider.presignUpload('object', null, 60, 100)).url)
    const download = new URL(
      (
        await provider.presignDownload(
          { bucket: 'test-transfers', region: 'us-east-1', key: 'object' },
          'file.pdf',
          60,
        )
      ).url,
    )

    for (const url of [upload, download]) {
      expect(url.origin).toBe('http://storage.example.test:9000')
      expect(url.pathname).toBe('/test-transfers/object')
    }
  } finally {
    config.fileTransfer.s3 = original
  }
})
