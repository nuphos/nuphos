import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { Table } from '../../components/Table'
import { useResetOnKey } from '../useResetOnKey'

import { mrColumns, pipelineColumns } from './gitlabColumns'
import { ErrorPanel, LoadingPanel } from './panels'

import type { GitlabBinding, GitlabMergeRequest, GitlabPipeline, GitlabProject } from '../../types'
import type { GitlabMrState, GitlabProjectTab } from '../gitlabNav'

export function ProjectDetail({
  teamId,
  binding,
  project,
  filter,
  refreshKey,
  onCount,
  tab,
  mrState,
  onTabChange,
  onMrStateChange,
}: {
  teamId: string
  binding: GitlabBinding
  project: GitlabProject
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  tab: GitlabProjectTab
  mrState: GitlabMrState
  onTabChange: (t: GitlabProjectTab) => void
  onMrStateChange: (s: GitlabMrState) => void
}) {
  const [mrs, setMrs] = useState<GitlabMergeRequest[] | null>(null)
  const [mrsError, setMrsError] = useState<string | null>(null)
  const mrsReqRef = useRef(0)

  const [pipelines, setPipelines] = useState<GitlabPipeline[] | null>(null)
  const [pipelinesError, setPipelinesError] = useState<string | null>(null)
  const pipelinesReqRef = useRef(0)

  const loadMrs = useCallback(() => {
    const req = ++mrsReqRef.current

    api
      .atlasListGitlabMergeRequests(teamId, binding.id, project.id, mrState)
      .then((rows) => {
        if (req !== mrsReqRef.current) return
        setMrs(rows)
      })
      .catch((e: unknown) => {
        if (req !== mrsReqRef.current) return
        setMrsError(String(e instanceof Error ? e.message : e))
      })
  }, [teamId, binding.id, project.id, mrState])

  const loadPipelines = useCallback(() => {
    const req = ++pipelinesReqRef.current

    api
      .atlasListGitlabPipelines(teamId, binding.id, project.id, 1)
      .then((rows) => {
        if (req !== pipelinesReqRef.current) return
        setPipelines(rows)
      })
      .catch((e: unknown) => {
        if (req !== pipelinesReqRef.current) return
        setPipelinesError(String(e instanceof Error ? e.message : e))
      })
  }, [teamId, binding.id, project.id])

  useResetOnKey(
    `${teamId}|${binding.id}|${String(project.id)}|${mrState}|${String(refreshKey)}`,
    () => {
      setMrs(null)
      setMrsError(null)
    },
  )

  useResetOnKey(`${teamId}|${binding.id}|${String(project.id)}|${String(refreshKey)}`, () => {
    setPipelines(null)
    setPipelinesError(null)
  })

  useEffect(() => {
    loadMrs()
  }, [loadMrs, refreshKey])

  useEffect(() => {
    loadPipelines()
  }, [loadPipelines, refreshKey])

  const filteredMrs = useMemo(() => {
    const list = mrs ?? []
    const f = filter.trim().toLowerCase()

    if (!f) return list

    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(f) ||
        (m.author ?? '').toLowerCase().includes(f) ||
        m.sourceBranch.toLowerCase().includes(f),
    )
  }, [mrs, filter])

  const filteredPipelines = useMemo(() => {
    const list = pipelines ?? []
    const f = filter.trim().toLowerCase()

    if (!f) return list

    return list.filter(
      (p) =>
        (p.ref ?? '').toLowerCase().includes(f) ||
        p.status.toLowerCase().includes(f) ||
        p.source.toLowerCase().includes(f),
    )
  }, [pipelines, filter])

  useEffect(() => {
    if (tab === 'merge-requests') onCount(filteredMrs.length)
    else onCount(filteredPipelines.length)
  }, [tab, filteredMrs.length, filteredPipelines.length, onCount])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-zGray-800 flex items-center gap-3 flex-shrink-0">
        <div className="flex gap-1">
          <button
            onClick={() => onTabChange('merge-requests')}
            className={`h-7 px-3 rounded-md text-[12px] ${
              tab === 'merge-requests'
                ? 'bg-zGray-800 text-main'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            Merge requests
          </button>
          <button
            onClick={() => onTabChange('pipelines')}
            className={`h-7 px-3 rounded-md text-[12px] ${
              tab === 'pipelines' ? 'bg-zGray-800 text-main' : 'text-tertiary hover:text-secondary'
            }`}
          >
            Pipelines
          </button>
        </div>
        {tab === 'merge-requests' && (
          <div className="ml-auto flex gap-1">
            {(['opened', 'merged', 'closed', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onMrStateChange(s)}
                className={`h-6 px-2 rounded text-[11px] ${
                  mrState === s ? 'bg-zGray-800 text-main' : 'text-tertiary hover:text-secondary'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'merge-requests' ? (
        mrsError ? (
          <ErrorPanel message={mrsError} />
        ) : mrs === null ? (
          <LoadingPanel />
        ) : (
          <Table<GitlabMergeRequest>
            columns={mrColumns}
            rows={filteredMrs}
            rowKey={(m) => String(m.iid)}
            storageKey={`gitlab.mrs.${binding.id}.${String(project.id)}`}
            empty={
              filter
                ? `No MRs match "${filter}"`
                : `No ${mrState === 'all' ? '' : mrState + ' '}merge requests`
            }
            onPrimaryAction={(m) => window.open(m.webUrl, '_blank')}
          />
        )
      ) : pipelinesError ? (
        <ErrorPanel message={pipelinesError} />
      ) : pipelines === null ? (
        <LoadingPanel />
      ) : (
        <Table<GitlabPipeline>
          columns={pipelineColumns}
          rows={filteredPipelines}
          rowKey={(p) => String(p.id)}
          storageKey={`gitlab.pipelines.${binding.id}.${String(project.id)}`}
          empty={filter ? `No pipelines match "${filter}"` : 'No pipelines'}
          onPrimaryAction={(p) => window.open(p.webUrl, '_blank')}
        />
      )}
    </div>
  )
}
