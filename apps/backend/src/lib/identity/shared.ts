import { runtimeProvider } from '@/lib/claude-code-preview/runtime-provider'
import { db } from '@/lib/db'

import type {
  NuphosTeam,
  NuphosTeamRole,
  NuphosUser,
  TeamBilling,
  TeamBillingSummary,
} from '@/lib/identity/types'
import type { Collection, ObjectId } from 'mongodb'

export type NuphosUserDoc = {
  _id: ObjectId
  email: string
  name: string
  username: string
  avatarURL: string
  language: string
  aiConsent?: { version: string; accepted: boolean; updatedAt: Date }
  passwordHash?: string
  sessionsInvalidBefore?: number
  profileEdited?: boolean
  googleID?: string
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

export type NuphosTeamDoc = {
  /** Approval claims serialize with team/member revocation on this document. */
  discordApprovalFence?: string
  _id: ObjectId
  name: string
  avatarUrl: string
  ownerID: ObjectId
  contactEmails: string[]
  allowedEmailDomains?: string[]
  /** Stored value; the retired `nuphos` and absent both map to Claude Code. */
  agentRuntime?: string
  members: {
    userId: ObjectId
    role: NuphosTeamRole
    joinedAt: Date
    deletedAt?: Date
  }[]
  billing?: TeamBilling
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

export const users = (): Collection<NuphosUserDoc> => db().collection<NuphosUserDoc>('users')

export const teams = (): Collection<NuphosTeamDoc> => db().collection<NuphosTeamDoc>('teams')

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function mapUser(user: NuphosUserDoc): NuphosUser {
  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    username: user.username,
    avatarURL: user.avatarURL,
    language: user.language,
    createdAt: user.createdAt.toISOString(),
  }
}

export function mapTeam(team: NuphosTeamDoc): NuphosTeam {
  return {
    id: team._id.toHexString(),
    name: team.name,
    avatarUrl: team.avatarUrl,
    ownerID: team.ownerID.toHexString(),
    contactEmails: team.contactEmails,
    allowedEmailDomains: team.allowedEmailDomains ?? [],
    agentRuntime: runtimeProvider(team.agentRuntime),
    createdAt: team.createdAt.toISOString(),
    billing: summarizeBilling(),
  }
}

/** Compatibility for older clients: every workspace has full access. */
export function summarizeBilling(): TeamBillingSummary {
  return { activated: true, active: true }
}
