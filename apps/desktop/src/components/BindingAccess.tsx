import { KeyRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { memberDisplayName, normalizeAllowList } from '../lib/bindingAccess'

import { AllowListSelect } from './binding-access-allow-list'
import { PROVIDERS } from './binding-access-providers'
import { toast } from './ui/toast'

import type { BindingAccessProvider } from './binding-access-providers'
import type { BindingAccess, TeamMember } from '../types'

export { AllowListSelect } from './binding-access-allow-list'
export type { BindingAccessProvider } from './binding-access-providers'

function memberLabelById(userId: string, members: TeamMember[]): string {
  const member = members.find((item) => item.id === userId)

  return member ? memberDisplayName(member) : 'a previous team member'
}

export function BindingAccessSection({
  teamId,
  provider,
  resourceId,
  secondaryId,
  principal,
  refreshKey = 0,
  onAccessChanged,
}: {
  teamId: string
  provider: BindingAccessProvider
  resourceId: string
  /** AWS role id / GCP binding id; unused by the single-id connectors. */
  secondaryId?: string
  principal?: string
  refreshKey?: number
  onAccessChanged?: (access: BindingAccess) => void
}) {
  const config = PROVIDERS[provider]
  const [members, setMembers] = useState<TeamMember[]>([])
  const [memberAllowList, setMemberAllowList] = useState<string[]>([])
  const [loadedAccess, setLoadedAccess] = useState<BindingAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const reqRef = useRef(0)

  // A new binding starts from a loading, not-saving slate; adjusting during
  // render keeps the previous binding's list from flashing as if it were this
  // one's.
  const bindingKey = `${teamId}|${provider}|${resourceId}|${secondaryId ?? ''}|${String(refreshKey)}`
  const [loadingKey, setLoadingKey] = useState(bindingKey)

  if (bindingKey !== loadingKey) {
    setLoadingKey(bindingKey)
    setLoading(true)
    setSaving(false)
  }

  useEffect(() => {
    const req = ++reqRef.current

    Promise.all([api.atlasListTeamMembers(teamId), config.load(teamId, resourceId, secondaryId)])
      .then(([teamMembers, access]) => {
        if (req !== reqRef.current) return
        setMembers(teamMembers)
        setMemberAllowList(normalizeAllowList(access.memberAllowList))
        setLoadedAccess(access)
      })
      .catch((err: unknown) => {
        if (req !== reqRef.current) return
        setMembers([])
        setMemberAllowList([])
        setLoadedAccess(null)
        toast.apiError('Failed to load access settings', err)
      })
      .finally(() => {
        if (req === reqRef.current) setLoading(false)
      })

    // Bump the generation on unmount//binding change so an in-flight save()
    // can tell it is stale — without this its response could overwrite the
    // newly-selected binding's list, and then be saved onto that credential.
    return () => {
      if (req === reqRef.current) reqRef.current += 1
    }
  }, [teamId, provider, resourceId, secondaryId, refreshKey])

  async function save() {
    const req = reqRef.current

    setSaving(true)
    try {
      const next = await config.save(
        teamId,
        resourceId,
        { memberAllowList: normalizeAllowList(memberAllowList) },
        secondaryId,
      )

      if (req !== reqRef.current) return
      setMemberAllowList(normalizeAllowList(next.memberAllowList))
      setLoadedAccess(next)
      onAccessChanged?.(next)
    } catch (err) {
      if (req !== reqRef.current) return
      toast.apiError('Failed to save access', err)
    } finally {
      if (req === reqRef.current) setSaving(false)
    }
  }

  return (
    <section className="px-6 py-4 border-t border-zGray-800/60">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="w-4 h-4 text-zViolet-accent" strokeWidth={1.8} />
        <h2 className="text-[13.5px] font-semibold text-main">Access List</h2>
        {principal && <span className="ml-auto text-[11.5px] text-tertiary">{principal}</span>}
      </div>
      <p className="mb-3 text-[12px] text-tertiary">
        Control which team members can use this {config.resourceLabel}, including from their agent
        sessions.
        {config.adminBypass && ' Team admins always have access, whether or not they are listed.'}
      </p>
      {loading ? (
        <div className="rounded-md border border-zGray-800 bg-zGray-950 px-3 py-6 text-center text-[12.5px] text-tertiary">
          Loading access...
        </div>
      ) : !loadedAccess ? null : (
        <>
          <div className="border-y border-zGray-800/60 divide-y divide-zGray-800/60">
            <AllowListSelect
              title="Access"
              subtitle={`Members allowed to use this ${config.resourceLabel}. Their agents can use it only when they also select it for a session.`}
              allowList={memberAllowList}
              members={members}
              onChange={setMemberAllowList}
            />
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11.5px] text-tertiary">
                {loadedAccess.updatedBy && (
                  <>
                    Last updated by {memberLabelById(loadedAccess.updatedBy, members)}
                    {loadedAccess.updatedAt
                      ? ` at ${new Date(loadedAccess.updatedAt).toLocaleString()}`
                      : ''}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="h-8 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] font-medium disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save access'}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
