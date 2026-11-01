import { useCallback, useEffect, useRef } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { LoadState } from './skillsShared'
import type {
  SkillScope,
  TeamSkillHistory,
  TeamSkillObject,
  TeamSkillObjectDetail,
  TeamSkillSummary,
} from '../../api'
import type { RefObject } from 'react'

type ActionsArgs = {
  teamId: string
  scope: SkillScope
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
  detailRequestRef: RefObject<number>
  fileInputRef: RefObject<HTMLInputElement | null>
  reloadWithSkeleton: () => Promise<void>
}

export function useSkillActions(args: ActionsArgs) {
  const {
    teamId,
    scope,
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
          api.teamSkillsListObjects(teamId, scope),
          api.teamSkillsGetHistory(teamId, skill.name, scope).catch((err: unknown) => {
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
          const detail = await api.teamSkillsGetObject(teamId, skillMdKey, scope)

          if (detailRequestRef.current === requestId) {
            setSkillMd(detail)
          }
        }
      } catch (err) {
        console.warn('[skills] failed to load skill detail', err)
        toast.apiError(t('Failed to load skill'), err)
      } finally {
        if (detailRequestRef.current === requestId) {
          setDetailLoading(false)
        }
      }
    },
    [
      teamId,
      scope,
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
      const manifest = await api.teamSkillsGetManifest(teamId, scope)
      const skill = manifest.skills.find((item) => item.name === name)

      if (skill) void loadSkillDetail(skill)
    },
    [loadSkillDetail, scope, teamId],
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
        toast.error(t('Permission denied'), t('Only team administrators can delete skill files.'))

        return
      }
      try {
        await api.teamSkillsDeleteObject(teamId, key, scope)
        toast.success(t('Deleted'), key)
        await reloadWithSkeleton()
        if (selectedName) await reloadDetailForName(selectedName)
      } catch (err) {
        toast.apiError(t('Delete failed'), err)
      }
    },
    [canDelete, reloadDetailForName, reloadWithSkeleton, scope, selectedName, teamId],
  )

  const deleteSkill = useCallback(
    async (skill: TeamSkillSummary) => {
      if (!canDelete) {
        toast.error(t('Permission denied'), t('Only team administrators can delete skills.'))

        return
      }
      try {
        const result = await api.teamSkillsDeleteSkill(teamId, skill.name, scope)

        if (selectedName === skill.name) {
          setSelectedName(null)
          setSkillMd(null)
          setSkillFiles([])
          setSkillHistory(null)
        }
        toast.success(
          t('Skill deleted'),
          result.deletedCount === 1
            ? t('{name} ({count} file)', { name: result.name, count: '1' })
            : t('{name} ({count} files)', {
                name: result.name,
                count: String(result.deletedCount),
              }),
        )
        await reloadWithSkeleton()
      } catch (err) {
        toast.apiError(t('Delete failed'), err)
      }
    },
    [
      canDelete,
      reloadWithSkeleton,
      scope,
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
        toast.error(t('Permission denied'), t('Editors and administrators can upload skill files.'))

        return
      }
      if (!file.name.trim()) {
        toast.error(t('Invalid file'), t('Choose a file with a name.'))

        return
      }
      let key = (keyOverride ?? uploadKey).trim()

      if (key.endsWith('/')) {
        key = `${key}${file.name}`
      }
      if (!key.startsWith('skills/')) {
        toast.error(t('Invalid key'), t('Key must start with skills/'))

        return
      }
      setUploading(true)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())

        await api.teamSkillsPutObject(
          teamId,
          key,
          { filename: file.name, bytes, contentType: file.type || undefined },
          scope,
        )
        toast.success(t('Uploaded'), key)
        await reloadWithSkeleton()
        if (selectedName) await reloadDetailForName(selectedName)
      } catch (err) {
        toast.apiError(t('Upload failed'), err)
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [
      canEdit,
      reloadDetailForName,
      reloadWithSkeleton,
      scope,
      selectedName,
      teamId,
      uploadKey,
      fileInputRef,
      setUploading,
    ],
  )

  return { loadSkillDetail, deleteObject, deleteSkill, uploadFile }
}
