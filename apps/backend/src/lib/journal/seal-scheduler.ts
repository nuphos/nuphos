// BullMQ wiring for the journal sealer, modeled on trigger-scheduler.ts. Two
// repeatable jobs share one queue with a single-concurrency worker (the
// sealer's CAS claim also tolerates concurrent runs, but one worker keeps S3
// traffic tidy):
//
//   - seal:      every config.journal.sealCron (default */5) — unsealed events
//                → next segment
//   - inventory: daily — conversation-head snapshot segment (deletion
//                detection, v2 #4)
//
// The scheduler only starts when Redis AND the journal S3 bucket are
// configured. Absence of the bucket is a deployment tier decision (L1-only,
// hot-chain integrity), not a runtime kill-switch: the fail-closed append
// path in journal-capture is active regardless of this scheduler.

import { KMSClient, SignCommand } from '@aws-sdk/client-kms'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Queue, Worker } from 'bullmq'

import { config } from '@/config'
import { buildBullMQConnection } from '@/lib/agent/trigger-scheduler'
import { db } from '@/lib/db'
import { logError, logEvent } from '@/lib/observability'
import { redisEnabled } from '@/lib/redis'
import { makeS3Client } from '@/lib/storage/s3-client'

import { anchorOnce } from './anchor'
import { JOURNAL_COLLECTION } from './append'
import { SEAL_STATE_COLLECTION, sealInventory, sealOnce } from './sealer'

import type { AnchorDeps } from './anchor'
import type { JournalDoc } from './append'
import type { SealStateDoc, SealerDeps } from './sealer'
import type { SegmentSignature } from './segment'
import type { Collection } from 'mongodb'

const QUEUE_NAME = 'journal-sealer'

let _queue: Queue | undefined
let _worker: Worker | undefined

function buildDeps(): SealerDeps {
  const bucket = config.journal.s3Bucket

  if (!bucket) throw new Error('journal sealer requires JOURNAL_S3_BUCKET')

  const s3 = makeS3Client({
    region: config.journal.s3Region,
    accessKeyId: config.journal.awsAccessKeyId,
    secretAccessKey: config.journal.awsSecretAccessKey,
    endpoint: config.journal.s3Endpoint,
    // The sealer writes through the SDK (no presigning), so it keeps the SDK
    // default and its WORM objects stay checksummed.
    requestChecksumCalculation: undefined,
  })
  const kms = config.journal.kmsSigningKeyId
    ? new KMSClient({
        region: config.journal.s3Region,
        ...(config.journal.awsAccessKeyId && config.journal.awsSecretAccessKey
          ? {
              credentials: {
                accessKeyId: config.journal.awsAccessKeyId,
                secretAccessKey: config.journal.awsSecretAccessKey,
              },
            }
          : {}),
      })
    : null

  const putObject = async (key: string, body: string | Uint8Array) => {
    const retainUntil = new Date(Date.now() + config.journal.retentionDays * 24 * 60 * 60 * 1000)

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: key.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json',
        ObjectLockMode: 'GOVERNANCE',
        ObjectLockRetainUntilDate: retainUntil,
      }),
    )
  }

  const objectExists = async (key: string) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))

      return true
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound') return false
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        return false
      }
      throw err
    }
  }

  const sign =
    kms && config.journal.kmsSigningKeyId
      ? async (manifestHash: string): Promise<SegmentSignature | null> => {
          const response = await kms.send(
            new SignCommand({
              KeyId: config.journal.kmsSigningKeyId,
              Message: Buffer.from(manifestHash, 'hex'),
              MessageType: 'DIGEST',
              SigningAlgorithm: 'ECDSA_SHA_256',
            }),
          )

          if (!response.Signature) return null

          return {
            alg: 'ECDSA_SHA_256',
            keyId: config.journal.kmsSigningKeyId!,
            signatureBase64: Buffer.from(response.Signature).toString('base64'),
          }
        }
      : null

  return {
    journal: db().collection<JournalDoc>(JOURNAL_COLLECTION) as Collection<JournalDoc>,
    state: db().collection<SealStateDoc>(SEAL_STATE_COLLECTION) as Collection<SealStateDoc>,
    putObject,
    objectExists,
    sign,
    now: () => new Date(),
  }
}

function buildAnchorDeps(sealerDeps: SealerDeps): AnchorDeps {
  // Bounded fetches: the worker runs with concurrency 1, so a hung TSA or
  // GitHub request would otherwise stall sealing/inventory/anchoring outright.
  const ANCHOR_FETCH_TIMEOUT_MS = 15_000

  const requestTimestamp = config.journal.tsaUrl
    ? async (request: Uint8Array): Promise<Uint8Array> => {
        const response = await fetch(config.journal.tsaUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/timestamp-query' },
          body: request,
          signal: AbortSignal.timeout(ANCHOR_FETCH_TIMEOUT_MS),
        })

        if (!response.ok) throw new Error(`TSA responded ${String(response.status)}`)

        return new Uint8Array(await response.arrayBuffer())
      }
    : null

  const repo = config.journal.anchorGithubRepo
  const token = config.journal.anchorGithubToken
  const appendGitAnchor =
    repo && token
      ? async (line: string): Promise<void> => {
          const api = `https://api.github.com/repos/${repo}/contents/${config.journal.anchorGithubPath}`
          const headers = {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          }
          const current = await fetch(api, {
            headers,
            signal: AbortSignal.timeout(ANCHOR_FETCH_TIMEOUT_MS),
          })
          let existing = ''
          let sha: string | undefined

          if (current.ok) {
            const file = (await current.json()) as { content?: string; sha?: string }

            existing = Buffer.from(file.content ?? '', 'base64').toString('utf8')
            sha = file.sha
          } else if (current.status !== 404) {
            throw new Error(`GitHub anchor read failed: ${String(current.status)}`)
          }
          const updated = await fetch(api, {
            method: 'PUT',
            headers,
            signal: AbortSignal.timeout(ANCHOR_FETCH_TIMEOUT_MS),
            body: JSON.stringify({
              message: `journal anchor ${line.slice(0, 10)}`,
              content: Buffer.from(`${existing + line}\n`, 'utf8').toString('base64'),
              ...(sha ? { sha } : {}),
            }),
          })

          if (!updated.ok) throw new Error(`GitHub anchor write failed: ${String(updated.status)}`)
        }
      : null

  return {
    state: sealerDeps.state,
    putObject: sealerDeps.putObject,
    requestTimestamp,
    appendGitAnchor,
    now: sealerDeps.now,
  }
}

/** Returns true when started; false when skipped (Redis or bucket unconfigured). */
export async function initJournalSealer(): Promise<boolean> {
  if (!config.journal.s3Bucket) {
    logEvent('warn', 'journal.sealer.disabled_no_bucket')

    return false
  }
  if (!redisEnabled()) {
    logEvent('warn', 'journal.sealer.disabled_no_redis')

    return false
  }

  const connection = buildBullMQConnection()

  _queue = new Queue(QUEUE_NAME, { connection })
  _worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const deps = buildDeps()

      if (job.name === 'inventory') {
        await sealInventory(deps)
      } else if (job.name === 'anchor') {
        await anchorOnce(buildAnchorDeps(deps))
      } else {
        await sealOnce(deps, { maxEvents: config.journal.sealMaxEvents })
      }
    },
    { connection, concurrency: 1 },
  )
  _worker.on('failed', (job, err) => {
    logError('journal.sealer.job_failed', err, { job_id: job?.id, job_name: job?.name })
  })

  await _queue.upsertJobScheduler(
    'journal-seal',
    { pattern: config.journal.sealCron },
    { name: 'seal', opts: { attempts: 1, removeOnComplete: 50, removeOnFail: 50 } },
  )
  await _queue.upsertJobScheduler(
    'journal-inventory',
    { pattern: config.journal.inventoryCron },
    { name: 'inventory', opts: { attempts: 1, removeOnComplete: 10, removeOnFail: 10 } },
  )
  await _queue.upsertJobScheduler(
    'journal-anchor',
    { pattern: config.journal.anchorCron },
    { name: 'anchor', opts: { attempts: 1, removeOnComplete: 10, removeOnFail: 10 } },
  )

  logEvent('info', 'journal.sealer.initialized', {
    seal_cron: config.journal.sealCron,
    inventory_cron: config.journal.inventoryCron,
    bucket: config.journal.s3Bucket,
    kms_signing: !!config.journal.kmsSigningKeyId,
  })

  return true
}

export async function shutdownJournalSealer(): Promise<void> {
  await _worker?.close()
  await _queue?.close()
  _worker = undefined
  _queue = undefined
}
