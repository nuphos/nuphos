import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { useSilentTick } from '../../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useResetOnKey } from '../useResetOnKey'

import { canDeleteSkills, canEditSkills } from './skillsShared'

import type { LoadState, MenuState } from './skillsShared'
import type { TeamSkillHistory, TeamSkillObject, TeamSkillObjectDetail } from '../../api'
import type { TeamMember } from '../../types'

type ListArgs = {
  teamId: string
  currentUserId: string
  refreshKey: number
  filter: string
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function useTeamSkills({
  teamId,
  currentUserId,
  refreshKey,
  filter,
  onCount,
  onLoading,
}: ListArgs) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [members, setMembers] = useState<TeamMember[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [skillMd, setSkillMd] = useState<TeamSkillObjectDetail | null>(null)
  const [skillFiles, setSkillFiles] = useState<TeamSkillObject[]>([])
  const [skillHistory, setSkillHistory] = useState<TeamSkillHistory | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [uploadKey, setUploadKey] = useState('')
  const [uploading, setUploading] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentRole = useMemo(
    () => members.find((member) => member.id === currentUserId)?.role,
    [members, currentUserId],
  )
  const canEdit = canEditSkills(currentRole)
  const canDelete = canDeleteSkills(currentRole)

  useEffect(() => {
    let alive = true

    api
      .atlasListTeamMembers(teamId)
      .then((nextMembers) => {
        if (alive) setMembers(nextMembers)
      })
      .catch(() => {
        if (alive) setMembers([])
      })

    return () => {
      alive = false
    }
  }, [teamId])

  const reload = useCallback(() => {
    const requestId = listRequestRef.current + 1

    listRequestRef.current = requestId
    onLoading?.(true)

    return api
      .teamSkillsGetManifest(teamId)
      .then((manifest) => {
        if (listRequestRef.current !== requestId) return
        setState({ kind: 'ready', manifest })
        setSelectedName((current) =>
          current && manifest.skills.some((skill) => skill.name === current) ? current : null,
        )
      })
      .catch((err: unknown) => {
        if (listRequestRef.current !== requestId) return
        const parsed = parseAtlasError(err)
        const unconfigured =
          parsed.code === 'skills_store_unconfigured' || parsed.message.includes('skills store')

        setState({
          kind: 'error',
          message: parsed.message,
          unconfigured,
        })
      })
      .finally(() => {
        if (listRequestRef.current === requestId) {
          onLoading?.(false)
        }
      })
  }, [onLoading, teamId])

  // `reload` is kicked from the effect below, so the skeleton flip it used to
  // do lives here instead; event-driven callers use `reloadWithSkeleton`.
  useResetOnKey(`${teamId}|${String(refreshKey)}`, () => setState({ kind: 'loading' }))

  const reloadWithSkeleton = useCallback(async () => {
    setState({ kind: 'loading' })
    await reload()
  }, [reload])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  const { pollTick } = useWorkspaceTab()
  const silentRefresh = useCallback(async () => {
    if (state.kind !== 'ready') return
    const requestId = listRequestRef.current + 1

    listRequestRef.current = requestId
    try {
      const manifest = await api.teamSkillsGetManifest(teamId)

      if (listRequestRef.current !== requestId) return
      setState({ kind: 'ready', manifest })
    } catch {
      // swallow; next foreground load surfaces errors
    }
  }, [state, teamId])

  useSilentTick(() => {
    void silentRefresh()
  }, pollTick)

  const rows = useMemo(() => {
    if (state.kind !== 'ready') return []
    const normalized = filter.trim().toLowerCase()

    if (!normalized) return state.manifest.skills

    return state.manifest.skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(normalized) ||
        (skill.description?.toLowerCase().includes(normalized) ?? false),
    )
  }, [state, filter])

  useEffect(() => {
    if (state.kind === 'ready') onCount?.(rows.length)
  }, [state.kind, rows.length, onCount])

  const selectedSkill = useMemo(() => {
    if (!selectedName || state.kind !== 'ready') return null

    return state.manifest.skills.find((skill) => skill.name === selectedName) ?? null
  }, [selectedName, state])

  return {
    state,
    members,
    selectedName,
    setSelectedName,
    skillMd,
    setSkillMd,
    skillFiles,
    setSkillFiles,
    skillHistory,
    setSkillHistory,
    detailLoading,
    setDetailLoading,
    uploadKey,
    setUploadKey,
    uploading,
    setUploading,
    menu,
    setMenu,
    listRequestRef,
    detailRequestRef,
    fileInputRef,
    canEdit,
    canDelete,
    reload,
    reloadWithSkeleton,
    rows,
    selectedSkill,
  }
}
