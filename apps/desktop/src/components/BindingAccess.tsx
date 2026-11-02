import { KeyRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { t } from '../i18n'
import { memberDisplayName, normalizeAllowList } from '../lib/bindingAccess'

import { AllowListSelect } from './binding-access-allow-list'
import { PROVIDERS } from './binding-access-providers'
import { Button } from './ui/button'
import { toast } from './ui/toast'

import type { BindingAccessProvider } from './binding-access-providers'
import type { BindingAccess, TeamMember } from '../types'

export { AllowListSelect } from './binding-access-allow-list'
export type { BindingAccessProvider } from './binding-access-providers'

function memberLabelById(userId: string, members: TeamMember[]): string {
  const member = members.find((item) => item.id === userId)

  return member ? memberDisplayName(member) : t('a previous team member')
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
        toast.apiError(t('Failed to load access settings'), err)
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
      toast.apiError(t('Failed to save access'), err)
    } finally {
      if (req === reqRef.current) setSaving(false)
    }
  }

  return (
    <section className="px-6 py-4 border-t border-zGray-800/60">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="w-4 h-4 text-zViolet-accent" strokeWidth={1.8} />
        <h2 className="text-[13.5px] font-semibold text-main">{t('Access List')}</h2>
        {principal && <span className="ml-auto text-[11.5px] text-tertiary">{principal}</span>}
      </div>
      <p className="mb-3 text-[12px] text-tertiary">
        {config.adminBypass
          ? t(
              'Control which team members can use this {resource}, including from their agents. Team admins always have access, whether or not they are listed.',
              { resource: config.resourceLabel },
            )
          : t('Control which team members can use this {resource}, including from their agents.', {
              resource: config.resourceLabel,
            })}
      </p>
      {loading ? (
        <div className="rounded-md border border-zGray-800 bg-zGray-950 px-3 py-6 text-center text-[12.5px] text-tertiary">
          {t('Loading access...')}
        </div>
      ) : !loadedAccess ? null : (
        <>
          <div className="border-y border-zGray-800/60 divide-y divide-zGray-800/60">
            <AllowListSelect
              title={t('Access')}
              subtitle={t(
                'Members allowed to use this {resource}. Their agents can use it only when they also select it for that agent.',
                { resource: config.resourceLabel },
              )}
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
                    {loadedAccess.updatedAt
                      ? t('Last updated by {name} at {time}', {
                          name: memberLabelById(loadedAccess.updatedBy, members),
                          time: new Date(loadedAccess.updatedAt).toLocaleString(),
                        })
                      : t('Last updated by {name}', {
                          name: memberLabelById(loadedAccess.updatedBy, members),
                        })}
                  </>
                )}
              </div>
              <Button size="sm" type="button" onClick={() => void save()} disabled={saving}>
                {saving ? t('Saving...') : t('Save access')}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
