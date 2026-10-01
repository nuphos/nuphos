import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import type { LoadState, MenuState } from './skillsShared'
import type {
  TeamSkillHistory,
  TeamSkillObject,
  TeamSkillObjectDetail,
  TeamSkillSummary,
} from '../../api'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { RefObject } from 'react'

type ActionsArgs = {
  teamId: string
  filter: string
  state: LoadState
  canEdit: boolean
  canDelete: boolean
  selectedName: string | null
  setSelectedName: React.Dispatch<React.SetStateAction<string | null>>
  setSkillMd: React.Dispatch<React.SetStateAction<TeamSkillObjectDetail | null>>
  setSkillFiles: React.Dispatch<React.SetStateAction<TeamSkillObject[]>>
  setSkillHistory: React.Dispatch<React.SetStateAction<TeamSkillHistory | null>>
  setDetailLoading: React.Dispatch<React.SetStateAction<boolean>>
  uploadKey: string
  setUploadKey: React.Dispatch<React.SetStateAction<string>>
  setUploading: React.Dispatch<React.SetStateAction<boolean>>
  menu: MenuState | null
  detailRequestRef: RefObject<number>
  fileInputRef: RefObject<HTMLInputElement | null>
  reloadWithSkeleton: () => Promise<void>
}

export function useSkillActions(args: ActionsArgs) {
  const {
    teamId,
    filter,
    state,
    canEdit,
    canDelete,
    selectedName,
    setSelectedName,
    setSkillMd,
    setSkillFiles,
    setSkillHistory,
    setDetailLoading,
    uploadKey,
    setUploadKey,
    setUploading,
    menu,
    detailRequestRef,
    fileInputRef,
    reloadWithSkeleton,
  } = args
  const loadSkillDetail = useCallback(
    async (skill: TeamSkillSummary) => {
      const requestId = detailRequestRef.current + 1

      detailRequestRef.current = requestId
      setSelectedName(skill.name)
      setUploadKey(`skills/${skill.name}/`)
      setSkillMd(null)
      setSkillFiles([])
      setSkillHistory(null)
      setDetailLoading(true)
      try {
        const [listing, history] = await Promise.all([
          api.teamSkillsListObjects(teamId),
          api.teamSkillsGetHistory(teamId, skill.name).catch((err: unknown) => {
            console.warn('[skills] failed to load skill history', err)

            return null
          }),
        ])

        if (detailRequestRef.current !== requestId) return
        const prefix = `skills/${skill.name}/`
        const files = listing.objects.filter((obj) => obj.key.startsWith(prefix))

        setSkillFiles(files)
        setSkillHistory(history)
        const skillMdKey = `${prefix}SKILL.md`

        if (files.some((file) => file.key === skillMdKey)) {
          const detail = await api.teamSkillsGetObject(teamId, skillMdKey)

          if (detailRequestRef.current === requestId) {
            setSkillMd(detail)
          }
        }
      } catch (err) {
        console.warn('[skills] failed to load skill detail', err)
        toast.apiError('Failed to load skill', err)
      } finally {
        if (detailRequestRef.current === requestId) {
          setDetailLoading(false)
        }
      }
    },
    [
      teamId,
      detailRequestRef,
      setDetailLoading,
      setSelectedName,
      setSkillFiles,
      setSkillHistory,
      setSkillMd,
      setUploadKey,
    ],
  )

  const reloadDetailForName = useCallback(
    async (name: string) => {
      const manifest = await api.teamSkillsGetManifest(teamId)
      const skill = manifest.skills.find((item) => item.name === name)

      if (skill) void loadSkillDetail(skill)
    },
    [loadSkillDetail, teamId],
  )

  const autoSelectedForRef = useRef<string | null>(null)

  useEffect(() => {
    const normalized = filter.trim()

    if (!normalized || state.kind !== 'ready') {
      autoSelectedForRef.current = null

      return
    }
    const exact = state.manifest.skills.find(
      (skill) => skill.name.toLowerCase() === normalized.toLowerCase(),
    )

    if (!exact) {
      autoSelectedForRef.current = null

      return
    }
    if (autoSelectedForRef.current === exact.name) return
    autoSelectedForRef.current = exact.name
    void loadSkillDetail(exact)
  }, [filter, state, loadSkillDetail])

  const deleteObject = useCallback(
    async (key: string) => {
      if (!canDelete) {
        toast.error('Permission denied', 'Only team administrators can delete skill files.')

        return
      }
      try {
        await api.teamSkillsDeleteObject(teamId, key)
        toast.success('Deleted', key)
        await reloadWithSkeleton()
        if (selectedName) await reloadDetailForName(selectedName)
      } catch (err) {
        toast.apiError('Delete failed', err)
      }
    },
    [canDelete, reloadDetailForName, reloadWithSkeleton, selectedName, teamId],
  )

  const deleteSkill = useCallback(
    async (skill: TeamSkillSummary) => {
      if (!canDelete) {
        toast.error('Permission denied', 'Only team administrators can delete skills.')

        return
      }
      try {
        const result = await api.teamSkillsDeleteSkill(teamId, skill.name)

        if (selectedName === skill.name) {
          setSelectedName(null)
          setSkillMd(null)
          setSkillFiles([])
          setSkillHistory(null)
        }
        toast.success(
          'Skill deleted',
          `${result.name} (${String(result.deletedCount)} file${result.deletedCount === 1 ? '' : 's'})`,
        )
        await reloadWithSkeleton()
      } catch (err) {
        toast.apiError('Delete failed', err)
      }
    },
    [
      canDelete,
      reloadWithSkeleton,
      selectedName,
      teamId,
      setSelectedName,
      setSkillFiles,
      setSkillHistory,
      setSkillMd,
    ],
  )

  const uploadFile = useCallback(
    async (file: File, keyOverride?: string) => {
      if (!canEdit) {
        toast.error('Permission denied', 'Editors and administrators can upload skill files.')

        return
      }
      if (!file.name.trim()) {
        toast.error('Invalid file', 'Choose a file with a name.')

        return
      }
      let key = (keyOverride ?? uploadKey).trim()

      if (key.endsWith('/')) {
        key = `${key}${file.name}`
      }
      if (!key.startsWith('skills/')) {
        toast.error('Invalid key', 'Key must start with skills/')

        return
      }
      setUploading(true)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())

        await api.teamSkillsPutObject(teamId, key, {
          filename: file.name,
          bytes,
          contentType: file.type || undefined,
        })
        toast.success('Uploaded', key)
        await reloadWithSkeleton()
        if (selectedName) await reloadDetailForName(selectedName)
      } catch (err) {
        toast.apiError('Upload failed', err)
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [
      canEdit,
      reloadDetailForName,
      reloadWithSkeleton,
      selectedName,
      teamId,
      uploadKey,
      fileInputRef,
      setUploading,
    ],
  )

  // Built with useMemo, not a helper called from the JSX: a function invoked
  // during render may not reach a ref, and deleteSkill transitively does.
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu || !canDelete) return []
    const skill = menu.skill

    return [
      {
        key: 'delete-skill',
        label: 'Delete skill',
        icon: Trash2,
        destructive: true,
        confirm: `Delete skill "${skill.name}" and all ${String(skill.fileCount)} file(s)? This cannot be undone.`,
        onSelect: () => void deleteSkill(skill),
      },
    ]
  }, [menu, canDelete, deleteSkill])

  return { loadSkillDetail, deleteObject, deleteSkill, uploadFile, menuItems }
}
