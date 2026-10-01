import { ChevronRight, Code2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { useResetOnKey } from '../useResetOnKey'

import type { SonarqubeProject } from '../../types'

type SonarqubeProjectsState =
  | { status: 'loading'; projects: SonarqubeProject[]; total: number }
  | { status: 'ready'; projects: SonarqubeProject[]; total: number }
  | { status: 'error'; projects: SonarqubeProject[]; total: number; message: string }

export function SonarqubeConnectorGuide({
  teamId,
  connectorId,
  connectorName,
  refreshKey,
  onOpenAgentChat,
}: {
  teamId: string
  connectorId: string
  connectorName: string
  refreshKey: number
  onOpenAgentChat: (prompt: string, options?: { send?: boolean }) => void
}) {
  const [projectsState, setProjectsState] = useState<SonarqubeProjectsState>({
    status: 'loading',
    projects: [],
    total: 0,
  })

  useResetOnKey(`${teamId}|${connectorId}|${String(refreshKey)}`, () =>
    setProjectsState({ status: 'loading', projects: [], total: 0 }),
  )
  useEffect(() => {
    let cancelled = false

    api
      .atlasListSonarqubeProjects(teamId, connectorId, 1, 5)
      .then((page) => {
        if (cancelled) return
        const projects = page.components ?? []

        setProjectsState({
          status: 'ready',
          projects,
          total: page.paging?.total ?? projects.length,
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setProjectsState({
          status: 'error',
          projects: [],
          total: 0,
          message: parseAtlasError(error).message,
        })
      })

    return () => {
      cancelled = true
    }
  }, [teamId, connectorId, refreshKey])

  const withConnector = (request: string) =>
    `Use the connected SonarQube instance "${connectorName}" (connector ID ${connectorId}). ${request}`
  const openPrompt = (prompt: string) => onOpenAgentChat(withConnector(prompt), { send: false })

  const prompts = [
    {
      title: 'Review security findings',
      prompt:
        'List the visible projects, then prioritize their vulnerabilities and unreviewed Security Hotspots. Lead with the highest-risk findings and concrete remediation steps.',
    },
    {
      title: 'Check Quality Gates',
      prompt:
        'Check the Quality Gate status of every visible project. Explain each failed condition, distinguish new-code failures from overall debt, and recommend the next action.',
    },
    {
      title: 'Summarize code health',
      prompt:
        'Summarize the code-quality posture of every visible project, grouping repetitive issues by rule and component. Prioritize the most impactful fixes.',
    },
  ]

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-lg border border-zGray-800 bg-zGray-900/30 px-4 py-3">
        <div className="text-[12.5px] font-medium text-main">
          SonarQube provides the analysis data
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-tertiary">
          Nuphos reads results already stored in this SonarQube instance. Connecting does not
          automatically scan code or grant access to a source repository.
        </p>
      </div>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[12.5px] font-medium text-main">Available projects</h3>
          {projectsState.status === 'ready' && (
            <span className="rounded-full bg-zGray-850 px-2 py-0.5 text-[10.5px] text-tertiary">
              {projectsState.total}
            </span>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border border-zGray-800">
          {projectsState.status === 'loading' && (
            <div className="px-4 py-4 text-[12px] text-tertiary">Checking project access…</div>
          )}
          {projectsState.status === 'error' && (
            <div className="px-4 py-4">
              <div className="text-[12px] font-medium text-error">Could not read projects</div>
              <div className="mt-1 text-[11.5px] text-tertiary">{projectsState.message}</div>
            </div>
          )}
          {projectsState.status === 'ready' && projectsState.projects.length === 0 && (
            <div className="px-4 py-4">
              <div className="text-[12.5px] font-medium text-main">No visible projects yet</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-tertiary">
                This instance may not have any completed analyses, or the token user may not have
                Browse permission on its projects.
              </p>
            </div>
          )}
          {projectsState.status === 'ready' &&
            projectsState.projects.map((project, index) => (
              <div
                key={project.key}
                className={`flex items-center gap-3 px-4 py-3 ${
                  index > 0 ? 'border-t border-zGray-800/60' : ''
                }`}
              >
                <Code2 className="h-4 w-4 flex-shrink-0 text-tertiary" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-main">{project.name}</div>
                  <div className="truncate font-mono text-[10.5px] text-tertiary">
                    {project.key}
                  </div>
                </div>
              </div>
            ))}
        </div>
        {projectsState.status === 'ready' &&
          projectsState.total > projectsState.projects.length && (
            <div className="mt-1.5 text-[10.5px] text-tertiary">
              Showing the first {projectsState.projects.length} of {projectsState.total} projects.
            </div>
          )}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-1.5 px-3 text-[11px] uppercase text-tertiary">
          <Sparkles className="h-3 w-3 text-zViolet-accent" strokeWidth={2} />
          <span>Suggested for this connector</span>
        </div>
        <div className="space-y-0.5">
          {prompts.map(({ title, prompt }) => (
            <button
              key={title}
              type="button"
              onClick={() => openPrompt(prompt)}
              className="group flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-zGray-800/60 focus-visible:bg-zGray-800/60 focus-visible:ring-2 focus-visible:ring-zViolet-400/50"
            >
              <Sparkles
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-zViolet-accent"
                strokeWidth={1.8}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-secondary group-hover:text-main">{title}</div>
                <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-tertiary">
                  {prompt}
                </div>
              </div>
              <ChevronRight className="ml-auto mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
