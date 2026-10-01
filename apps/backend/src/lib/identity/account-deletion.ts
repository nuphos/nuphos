import { ObjectId } from 'mongodb'

import type { NuphosUser } from '@/lib/identity'

import { db } from '@/lib/db'
import { verifyEmailOtp } from '@/lib/email-otp'
import { AppError } from '@/lib/errors'
import { signInWithPassword } from '@/lib/identity/password'
import { users } from '@/lib/identity/shared'

type DeletionRequest = {
  _id: string
  email: string
  requestedAt: Date
  dueAt: Date
  status: 'requested' | 'in_progress' | 'completed'
  updatedAt: Date
  handledBy?: string
  evidence?: string
  completedAt?: Date
}

const requests = () => db().collection<DeletionRequest>('account_deletion_requests')

export async function getDeletionRequest(userId: string) {
  const request = await requests().findOne({ _id: userId })

  if (!request) return { request: null }

  return {
    request: { status: request.status, requestedAt: request.requestedAt, dueAt: request.dueAt },
  }
}

export async function requestAccountDeletion(user: NuphosUser, input: unknown) {
  const body = input as { confirmation?: unknown; code?: unknown; password?: unknown } | null

  if (
    body?.confirmation !== 'DELETE' ||
    (typeof body.code !== 'string' && typeof body.password !== 'string')
  ) {
    throw new AppError(
      400,
      'confirmation_required',
      'Enter DELETE and confirm with your password or an email verification code',
    )
  }
  const existing = await requests().findOne({ _id: user.id })

  if (existing) return getDeletionRequest(user.id)
  const verified =
    typeof body.password === 'string'
      ? await signInWithPassword({ email: user.email, password: body.password })
      : await verifyEmailOtp(user.email, body.code as string)

  if (verified.user.id !== user.id)
    throw new AppError(403, 'account_mismatch', 'Verify this account’s email')
  const now = new Date()

  // One durable request per identity. Retries cannot extend the 30-day deadline.
  await requests().updateOne(
    { _id: user.id },
    {
      $setOnInsert: {
        email: user.email,
        requestedAt: now,
        dueAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        status: 'requested',
        updatedAt: now,
      },
    },
    { upsert: true },
  )

  return getDeletionRequest(user.id)
}

export async function listDeletionRequests() {
  const items = await requests()
    .find({ status: { $ne: 'completed' } })
    .sort({ dueAt: 1 })
    .limit(200)
    .toArray()
  const total = await requests().countDocuments({ status: { $ne: 'completed' } })

  return {
    items: items.map((item) => ({ ...item, overdue: item.dueAt.getTime() < Date.now() })),
    total,
  }
}

export async function updateDeletionRequest(userId: string, adminUserId: string, input: unknown) {
  const body = input as { status?: unknown; evidence?: unknown } | null

  if (!ObjectId.isValid(userId) || !['in_progress', 'completed'].includes(String(body?.status))) {
    throw new AppError(400, 'invalid_request', 'Select a valid deletion request and status')
  }
  const evidence = typeof body?.evidence === 'string' ? body.evidence.trim() : ''

  if (evidence.length < 20 || evidence.length > 4000) {
    throw new AppError(
      400,
      'evidence_required',
      'Record 20–4000 characters of processing evidence without personal data',
    )
  }
  if (body?.status === 'completed') {
    // This is a receipt, not a delete button. Operators must finish the purge
    // runbook first; do not hide a still-active identity behind a completed flag.
    const account = await users().findOne({ _id: new ObjectId(userId) })

    if (account)
      throw new AppError(
        409,
        'account_not_erased',
        'Permanently erase the account and finish the deletion runbook before recording completion',
      )
  }
  const now = new Date()
  const result = await requests().updateOne(
    { _id: userId, status: { $ne: 'completed' } },
    {
      $set: {
        status: body!.status as 'in_progress' | 'completed',
        evidence,
        handledBy: adminUserId,
        updatedAt: now,
        ...(body?.status === 'completed' ? { email: '', completedAt: now } : {}),
      },
    },
  )

  if (!result.matchedCount) throw new AppError(404, 'not_found', 'Open deletion request not found')

  return { ok: true }
}
