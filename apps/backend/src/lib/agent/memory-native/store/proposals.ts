import { MongoServerError, ObjectId } from 'mongodb'

import { buildCjkSearchText } from '../search-text'

import {
  findSecretBearingContent,
  playbookContentHash,
  PROPOSAL_TTL_MS,
  proposalIdempotencyKey,
  teamMemories,
  teamMemoryProposals,
} from './shared'

import type { AgentTeamMemory, AgentTeamMemoryProposal, EmbeddedCase, Playbook } from '../types'

// Fold the target into the key so same-title correction retries do not dedupe into the original.
function proposalKey(conversationId: string, title: string, supersedesMemoryId?: ObjectId): string {
  return proposalIdempotencyKey(
    conversationId,
    supersedesMemoryId ? `${title} supersedes:${supersedesMemoryId.toHexString()}` : title,
  )
}

const SUPERSEDE_TARGET_UNAVAILABLE = Symbol('supersede target unavailable')

function publishedProposal(
  proposal: AgentTeamMemoryProposal,
  memoryId: ObjectId,
  supersededMemoryId: ObjectId | null | typeof SUPERSEDE_TARGET_UNAVAILABLE,
) {
  if (supersededMemoryId === SUPERSEDE_TARGET_UNAVAILABLE) {
    return { ok: false as const, error: 'supersedes target is no longer live' }
  }

  return {
    ok: true as const,
    memoryId: memoryId.toHexString(),
    title: proposal.draftGene.title,
    supersededMemoryId: supersededMemoryId?.toHexString() ?? null,
  }
}

export async function createProposal(input: {
  teamId: string
  userId: string
  conversationId: string
  playbook: Playbook
  caseRecord: EmbeddedCase
  // Revises an existing live playbook lineage instead of creating a new one.
  supersedesMemoryId?: ObjectId
}): Promise<{ ok: true; proposalId: string; existing: boolean } | { ok: false; error: string }> {
  const secretKinds = findSecretBearingContent({
    playbook: input.playbook,
    caseRecord: input.caseRecord,
  })

  if (secretKinds) {
    return {
      ok: false,
      error: `Draft contains secret-bearing content (${secretKinds}); remove secrets and reference them indirectly instead.`,
    }
  }
  // Non-resurrection gate (mirrors the flat-record tombstone gate below): a
  // playbook the team removed must not come back via an identical re-save — that
  // would bypass the restore authority (remover or ADMINISTRATOR, ADR-0005).
  // Rejected pools are tiny, so hashing them here beats persisting a hash;
  // it also covers tombstones written before this gate existed.
  const contentHash = playbookContentHash(input.playbook)
  const rejected = await teamMemories()
    .find(
      { teamId: input.teamId, status: 'rejected' as const },
      { projection: { gene: 1, updatedBy: 1 } },
    )
    .toArray()
  const tombstone = rejected.find((m) => playbookContentHash(m.gene) === contentHash)

  if (tombstone) {
    return {
      ok: false,
      error: `An identical team memory was previously removed${
        tombstone.updatedBy ? ` (${tombstone.updatedBy})` : ''
      } — not re-creating it. If it should come back, the person who removed it or a team ADMINISTRATOR can restore it from the Memories view.`,
    }
  }
  const idempotencyKey = proposalKey(
    input.conversationId,
    input.playbook.title,
    input.supersedesMemoryId,
  )
  const now = new Date()
  const existing = await teamMemoryProposals().findOne({ teamId: input.teamId, idempotencyKey })

  if (existing) {
    // Dedup only against proposals that can still lead somewhere: a live
    // pending proposal, or a published one whose playbook is still visible.
    // Otherwise (discarded/expired, or the playbook was later rejected via
    // delete) the key would permanently block re-proposing the same title in
    // this conversation — the agent gets ok:true but nothing ever appears.
    let reusable: boolean

    if (existing.status === 'proposed') {
      reusable = existing.expiresAt.getTime() > now.getTime()
    } else if (existing.status === 'published' && existing.publishedMemoryId) {
      const memory = await teamMemories().findOne(
        { _id: existing.publishedMemoryId },
        { projection: { status: 1 } },
      )

      // A MISSING doc is the publish claim→insert gap (or a crash inside it),
      // not a dead key: ensurePublishedMemory repairs it on the next publish.
      // Retiring here would let a concurrent re-propose double-publish the
      // same investigation under a new lineageId (TOCTOU). Only an explicit
      // tombstone retires the key.
      reusable = !memory || memory.status === 'active' || memory.status === 'needs_review'
    } else {
      reusable = false
    }
    if (reusable) return { ok: true, proposalId: existing._id.toHexString(), existing: true }
    // Retire the stale key by renaming (not $unset — the unique index treats
    // missing as null, so two retired keys would collide).
    await teamMemoryProposals().updateOne(
      { _id: existing._id, idempotencyKey },
      { $set: { idempotencyKey: `${idempotencyKey}:retired:${existing._id.toHexString()}` } },
    )
  }
  const doc: AgentTeamMemoryProposal = {
    _id: new ObjectId(),
    teamId: input.teamId,
    userId: input.userId,
    conversationId: input.conversationId,
    status: 'proposed',
    draftGene: input.playbook,
    draftCapsule: input.caseRecord,
    idempotencyKey,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
    ...(input.supersedesMemoryId ? { supersedesMemoryId: input.supersedesMemoryId } : {}),
  }

  try {
    await teamMemoryProposals().insertOne(doc)
  } catch (err) {
    // Concurrent re-propose after retirement: the loser re-reads the winner.
    if (err instanceof MongoServerError && err.code === 11000) {
      const winner = await teamMemoryProposals().findOne({ teamId: input.teamId, idempotencyKey })

      if (winner) return { ok: true, proposalId: winner._id.toHexString(), existing: true }
    }
    throw err
  }

  return { ok: true, proposalId: doc._id.toHexString(), existing: false }
}

export async function publishProposal(input: {
  teamId: string
  userId: string
  proposalId: string
}): Promise<
  | { ok: true; memoryId: string; title: string; supersededMemoryId: string | null }
  | { ok: false; error: string }
> {
  if (!ObjectId.isValid(input.proposalId)) return { ok: false, error: 'invalid proposalId' }
  const proposal = await teamMemoryProposals().findOne({
    _id: new ObjectId(input.proposalId),
    teamId: input.teamId,
  })

  if (!proposal) return { ok: false, error: 'proposal not found' }
  if (proposal.status === 'published' && proposal.publishedMemoryId) {
    // The playbook may have been soft-deleted since this proposal published; an
    // unconditional ok here would report success for an invisible memory.
    const memory = await teamMemories().findOne(
      { _id: proposal.publishedMemoryId },
      { projection: { status: 1 } },
    )

    if (memory && memory.status !== 'active' && memory.status !== 'needs_review') {
      return {
        ok: false,
        error:
          'the published memory has since been deleted — the person who removed it or a team ADMINISTRATOR can restore it from the Memories view',
      }
    }
    const supersededMemoryId = await ensurePublishedMemory(
      proposal,
      proposal.publishedMemoryId,
      input.userId,
    )

    return publishedProposal(proposal, proposal.publishedMemoryId, supersededMemoryId)
  }
  if (proposal.status !== 'proposed') return { ok: false, error: `proposal is ${proposal.status}` }
  if (proposal.expiresAt.getTime() < Date.now()) return { ok: false, error: 'proposal is expired' }
  // Claim the proposal atomically FIRST so concurrent publishes cannot both
  // insert a memory (§17.15: never two active revisions from one proposal).
  const _id = new ObjectId()
  const claim = await teamMemoryProposals().findOneAndUpdate(
    { _id: proposal._id, status: 'proposed' },
    { $set: { status: 'published', publishedMemoryId: _id } },
  )

  if (!claim) {
    // Lost the race — the winner's publishedMemoryId is authoritative.
    const winner = await teamMemoryProposals().findOne({ _id: proposal._id })

    if (winner?.status === 'published' && winner.publishedMemoryId) {
      const supersededMemoryId = await ensurePublishedMemory(
        winner,
        winner.publishedMemoryId,
        input.userId,
      )

      return publishedProposal(winner, winner.publishedMemoryId, supersededMemoryId)
    }

    return { ok: false, error: `proposal is ${winner?.status ?? 'missing'}` }
  }
  const supersededMemoryId = await ensurePublishedMemory(proposal, _id, input.userId)

  return publishedProposal(proposal, _id, supersededMemoryId)
}

// Insert the memory doc for a claimed proposal if it does not exist yet.
// Idempotent (fixed _id): re-publish after a crash between claim and insert
// repairs the missing doc; a duplicate-key race is benign.
async function ensurePublishedMemory(
  proposal: AgentTeamMemoryProposal,
  memoryId: ObjectId,
  publisherUserId: string,
): Promise<ObjectId | null | typeof SUPERSEDE_TARGET_UNAVAILABLE> {
  const existing = await teamMemories().findOne({ _id: memoryId }, { projection: { _id: 1 } })

  if (existing) return null
  const now = new Date()
  const searchText = buildCjkSearchText([
    proposal.draftGene.title,
    ...proposal.draftGene.triggerSignals,
    proposal.draftCapsule.problem,
    proposal.draftCapsule.rootCause,
  ])
  // Revise-by-lineage: a supersede proposal inherits the prior
  // playbook's lineage and bumps the revision; a plain proposal starts a fresh
  // lineage at revision 1. Read the prior at publish time so a target removed
  // between propose and publish falls back to a fresh lineage rather than
  // losing the correction.
  let lineageId = memoryId.toHexString()
  let revision = 1
  let supersedesId: ObjectId | undefined

  if (proposal.supersedesMemoryId) {
    const prior = await teamMemories().findOne(
      {
        _id: proposal.supersedesMemoryId,
        teamId: proposal.teamId,
        status: { $in: ['active', 'needs_review'] },
      },
      { projection: { lineageId: 1, revision: 1 } },
    )

    if (!prior) return SUPERSEDE_TARGET_UNAVAILABLE
    lineageId = prior.lineageId
    revision = prior.revision + 1
    supersedesId = prior._id
  }
  const memory: AgentTeamMemory = {
    _id: memoryId,
    teamId: proposal.teamId,
    lineageId,
    status: 'active',
    revision,
    gene: proposal.draftGene,
    capsules: [proposal.draftCapsule],
    createdBy: proposal.userId,
    createdAt: now,
    updatedBy: publisherUserId,
    updatedAt: now,
    ...(supersedesId ? { supersedesId } : {}),
    ...(searchText ? { searchText } : {}),
  }

  try {
    await teamMemories().insertOne(memory)
  } catch (err) {
    // Lost the insert race: the winner owns the lineage and its retirement.
    if ((err as { code?: number }).code === 11000) return null
    throw err
  }
  // Retire after the successor is live, accepting a brief overlap.
  if (supersedesId) {
    const retired = await teamMemories().updateOne(
      { _id: supersedesId, status: { $in: ['active', 'needs_review'] } },
      { $set: { status: 'superseded', updatedBy: publisherUserId, updatedAt: new Date() } },
    )

    return retired.modifiedCount > 0 ? supersedesId : null
  }

  return null
}
