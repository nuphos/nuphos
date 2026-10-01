import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useResetOnKey } from '../useResetOnKey'

import type {
  LarkAvailableChat,
  LarkConnectionStatus,
  LarkInstallation,
  LarkPairCode,
  LarkUserMapping,
  TeamMember,
} from '../../types'

// Prefer the live picker (groups the bot is in). If the app hasn't been granted
// the chat-read scope yet, fall back to the mappings that auto-linked on
// @mention so the admin still sees something actionable.
async function loadChats(tid: string): Promise<LarkAvailableChat[]> {
  try {
    return await api.atlasListLarkAvailableChats(tid)
  } catch {
    const mappings = await api.atlasListLarkChatMappings(tid).catch(() => [])

    return mappings.map((m) => ({
      chatId: m.chatId,
      name: m.name || m.chatId,
      linked: true,
      enabled: m.enabled,
    }))
  }
}

export function useLarkSettings(
  teamId: string | undefined,
  currentUserId: string,
  refreshKey: number | undefined,
) {
  const [installation, setInstallation] = useState<LarkInstallation | null>(null)
  const [availableChats, setAvailableChats] = useState<LarkAvailableChat[]>([])
  const [userMappings, setUserMappings] = useState<LarkUserMapping[]>([])
  const [status, setStatus] = useState<LarkConnectionStatus | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // The bot's event Request URL — shown persistently so an admin can re-copy it
  // long after the bind wizard closed (e.g. to reconfigure event subscriptions).
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null)
  const [webhookCopied, setWebhookCopied] = useState(false)
  // Self-serve account linking: a member generates this code and DMs it to the
  // bot to bind their own Lark account (a custom app can't read email to
  // auto-map). Lives in component state — codes are single-use and short-lived.
  const [pairCode, setPairCode] = useState<LarkPairCode | null>(null)
  const [pairGenerating, setPairGenerating] = useState(false)
  const [pairCopied, setPairCopied] = useState(false)

  const canManage = useMemo(
    () => members.find((member) => member.id === currentUserId)?.role === 'ADMINISTRATOR',
    [members, currentUserId],
  )

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])

  // Guards against a stale load overwriting fresher state: a team switch or an
  // overlapping refresh bumps the generation, and only the newest load applies.
  const loadGeneration = useRef(0)

  // Fetch and apply are split so every setState lives inside a promise
  // callback (react-hooks/set-state-in-effect): `load` only kicks the fetch.
  async function fetchSettings(id: string) {
    const teamMembers = await api.atlasListTeamMembers(id)
    const isAdmin =
      teamMembers.find((member) => member.id === currentUserId)?.role === 'ADMINISTRATOR'

    const [installInfo, connectionStatus, chats] = await Promise.all([
      api.atlasGetLarkInstallation(id),
      api.atlasGetLarkConnectionStatus(id),
      isAdmin ? loadChats(id) : Promise.resolve<LarkAvailableChat[]>([]),
    ])
    const users = isAdmin ? await api.atlasListLarkUserMappings(id) : []

    return { teamMembers, installInfo, connectionStatus, chats, users }
  }

  function load() {
    if (!teamId) return
    const gen = ++loadGeneration.current

    return fetchSettings(teamId)
      .then((next) => {
        if (gen !== loadGeneration.current) return
        setMembers(next.teamMembers)
        setInstallation(next.installInfo.installation)
        setWebhookUrl(next.installInfo.webhookUrl)
        setStatus(next.connectionStatus)
        setAvailableChats(next.chats)
        setUserMappings(next.users)
      })
      .catch((err: unknown) => {
        if (gen !== loadGeneration.current) return
        toast.apiError('Could not load Lark settings', err)
      })
      .finally(() => {
        if (gen === loadGeneration.current) setLoading(false)
      })
  }

  // `load` is kicked from the effect below, so the "now loading" flip it used
  // to do lives here instead.
  useResetOnKey(`${String(teamId)}|${String(refreshKey)}`, () => {
    if (teamId) setLoading(true)
  })

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, refreshKey])

  async function toggleChat(chat: LarkAvailableChat, enabled: boolean) {
    if (!teamId) return
    const key = `chat:${chat.chatId}`

    setBusyKey(key)
    // Optimistic: reflect the toggle immediately.
    setAvailableChats((prev) =>
      prev.map((c) => (c.chatId === chat.chatId ? { ...c, linked: true, enabled } : c)),
    )
    try {
      await api.atlasUpsertLarkChatMapping(teamId, {
        chatId: chat.chatId,
        enabled,
        name: chat.name,
      })
    } catch (err) {
      toast.apiError('Could not update group', err, {
        fallback: 'The change was not saved. Check your connection and try again.',
      })
      await load()
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteUser(mapping: LarkUserMapping) {
    if (!teamId) return
    const key = `user:${mapping.id}`

    setBusyKey(key)
    try {
      await api.atlasDeleteLarkUserMapping(teamId, mapping.larkOpenId)
      await load()
    } catch (err) {
      toast.apiError('Could not remove user mapping', err, {
        fallback: 'The mapping was not removed. Check your connection and try again.',
      })
    } finally {
      setBusyKey(null)
    }
  }

  async function copyWebhook() {
    if (!webhookUrl) return
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setWebhookCopied(true)
      setTimeout(() => setWebhookCopied(false), 1500)
    } catch {
      toast.error('Could not copy', 'Copy the URL manually.')
    }
  }

  async function generatePairCode() {
    if (!teamId || pairGenerating) return
    setPairGenerating(true)
    setPairCopied(false)
    try {
      setPairCode(await api.atlasCreateLarkPairCode(teamId))
    } catch (err) {
      toast.apiError('Could not generate pairing code', err)
    } finally {
      setPairGenerating(false)
    }
  }

  async function copyPairCode() {
    if (!pairCode) return
    try {
      await navigator.clipboard.writeText(pairCode.code)
      setPairCopied(true)
      setTimeout(() => setPairCopied(false), 1500)
    } catch {
      toast.error('Could not copy', 'Copy the code manually.')
    }
  }

  return {
    installation,
    availableChats,
    userMappings,
    status,
    loading,
    busyKey,
    webhookUrl,
    webhookCopied,
    pairCode,
    pairGenerating,
    pairCopied,
    canManage,
    memberById,
    toggleChat,
    deleteUser,
    copyWebhook,
    generatePairCode,
    copyPairCode,
    load,
  }
}
