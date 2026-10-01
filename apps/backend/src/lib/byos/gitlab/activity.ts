import { apiRequest } from './tokens'

import type { GitlabBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export type GitlabMergeRequest = {
  iid: number
  title: string
  state: 'opened' | 'closed' | 'merged' | 'locked'
  draft: boolean
  author: string | null
  authorAvatarUrl: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
}

type RawMergeRequest = {
  iid: number
  title: string
  state: 'opened' | 'closed' | 'merged' | 'locked'
  draft?: boolean
  work_in_progress?: boolean
  author: { username: string; avatar_url?: string | null } | null
  labels: string[]
  created_at: string
  updated_at: string
  web_url: string
  source_branch: string
  target_branch: string
}

function mapMergeRequest(raw: RawMergeRequest): GitlabMergeRequest {
  return {
    iid: raw.iid,
    title: raw.title,
    state: raw.state,
    draft: raw.draft ?? raw.work_in_progress ?? false,
    author: raw.author?.username ?? null,
    authorAvatarUrl: raw.author?.avatar_url ?? null,
    labels: raw.labels,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    webUrl: raw.web_url,
    sourceBranch: raw.source_branch,
    targetBranch: raw.target_branch,
  }
}

export async function listMergeRequests(
  teamId: ObjectId,
  binding: GitlabBinding,
  projectId: number,
  state: 'opened' | 'closed' | 'merged' | 'all',
  perPage: number,
  page: number,
): Promise<GitlabMergeRequest[]> {
  const stateParam = state === 'all' ? 'all' : state
  const raws = await apiRequest<RawMergeRequest[]>(
    teamId,
    binding,
    `/projects/${String(projectId)}/merge_requests?state=${stateParam}&per_page=${String(perPage)}&page=${String(page)}&order_by=updated_at&sort=desc`,
  )

  return raws.map(mapMergeRequest)
}

export type GitlabPipeline = {
  id: number
  status: string
  source: string
  ref: string | null
  sha: string
  webUrl: string
  createdAt: string
  updatedAt: string
}

type RawPipeline = {
  id: number
  status: string
  source: string
  ref: string | null
  sha: string
  web_url: string
  created_at: string
  updated_at: string
}

function mapPipeline(raw: RawPipeline): GitlabPipeline {
  return {
    id: raw.id,
    status: raw.status,
    source: raw.source,
    ref: raw.ref,
    sha: raw.sha,
    webUrl: raw.web_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

export async function listPipelines(
  teamId: ObjectId,
  binding: GitlabBinding,
  projectId: number,
  perPage: number,
  page: number,
): Promise<GitlabPipeline[]> {
  const raws = await apiRequest<RawPipeline[]>(
    teamId,
    binding,
    `/projects/${String(projectId)}/pipelines?per_page=${String(perPage)}&page=${String(page)}&order_by=id&sort=desc`,
  )

  return raws.map(mapPipeline)
}
