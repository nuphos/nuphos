// The file-transfer store: the RustFS image the compose stack runs, on this computer only.
import { spawnSync } from 'node:child_process'

import { spawn, until } from './processes.ts'

// Keep the tag in step with deploy/compose/docker-compose.yml and the e2e workflow's pull.
export const STORAGE_IMAGE = 'rustfs/rustfs:1.0.0'
const BUCKET = 'nuphos-e2e-transfers'
const ACCESS_KEY = 'local-e2e-storage-access-key'
const SECRET_KEY = 'local-e2e-storage-secret-key-not-a-production-credential'

/** Creates the bucket; RustFS answers its health check before its S3 API, so this is retried. */
function createBucket(endpoint: string): boolean {
  const status = spawnSync(
    'curl',
    [
      '-s',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '-X',
      'PUT',
      '--aws-sigv4',
      'aws:amz:us-east-1:s3',
      '--user',
      `${ACCESS_KEY}:${SECRET_KEY}`,
      `${endpoint}/${BUCKET}`,
    ],
    { encoding: 'utf8' },
  ).stdout

  return status === '200' || status === '409'
}

/** Starts the store and returns the backend's settings for it. */
export async function startStorage(port: number): Promise<Record<string, string>> {
  const endpoint = `http://127.0.0.1:${String(port)}`

  spawn('storage', [
    'docker',
    'run',
    '--rm',
    '-e',
    `RUSTFS_ACCESS_KEY=${ACCESS_KEY}`,
    '-e',
    `RUSTFS_SECRET_KEY=${SECRET_KEY}`,
    '-e',
    'RUSTFS_ADDRESS=0.0.0.0:9000',
    '-p',
    `127.0.0.1:${String(port)}:9000`,
    STORAGE_IMAGE,
  ])
  await until('the file-transfer bucket to exist', async () => createBucket(endpoint))

  return {
    NUPHOS_FILE_TRANSFER_S3_BUCKET: BUCKET,
    NUPHOS_FILE_TRANSFER_S3_ACCESS_KEY_ID: ACCESS_KEY,
    NUPHOS_FILE_TRANSFER_S3_SECRET_ACCESS_KEY: SECRET_KEY,
    NUPHOS_FILE_TRANSFER_S3_ENDPOINT: endpoint,
  }
}
