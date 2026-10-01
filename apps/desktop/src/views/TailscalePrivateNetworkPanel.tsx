import { Copy, ShieldAlert } from 'lucide-react'
import { useState } from 'react'

import { api } from '../api'
import { Switch } from '../components/ui/Switch'
import { toast } from '../components/ui/toast'

import { useResetOnKey } from './useResetOnKey'

import type { TailscaleSandboxAccess } from '../types'

const TAG_PATTERN = /^tag:[a-z0-9][a-z0-9-]{0,62}$/

/**
 * Private network access — the opt-in that lets an agent sandbox join the
 * customer's tailnet as a node, rather than only reading it through the API.
 *
 * Presented as a distinct grant, not a setting: it is strictly larger than what
 * binding the OAuth client conveys, and a customer's security review is
 * entitled to see it described that way.
 */
export function TailscalePrivateNetworkPanel({
  teamId,
  connectorId,
  sandboxAccess,
}: {
  teamId: string
  connectorId: string
  sandboxAccess: TailscaleSandboxAccess | null | undefined
}) {
  const [enabled, setEnabled] = useState(sandboxAccess?.enabled ?? false)
  const [tag, setTag] = useState(sandboxAccess?.tag ?? 'tag:nuphos')
  const [saving, setSaving] = useState(false)
  const [targetTag, setTargetTag] = useState('tag:staging')
  const [sshUser, setSshUser] = useState('deploy')
  const [recorderTag, setRecorderTag] = useState('')
  const [snippet, setSnippet] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  useResetOnKey(`${String(sandboxAccess?.enabled ?? false)}|${sandboxAccess?.tag ?? ''}`, () => {
    setEnabled(sandboxAccess?.enabled ?? false)
    setTag(sandboxAccess?.tag ?? 'tag:nuphos')
  })

  const tagValid = TAG_PATTERN.test(tag)

  const save = async (nextEnabled: boolean) => {
    // Revoking must never depend on the tag field being valid — an unsaved typo
    // would otherwise trap access in the on position.
    if (nextEnabled && !TAG_PATTERN.test(tag)) {
      toast.error('Enter a tag like tag:nuphos before enabling private network access')

      return
    }
    setSaving(true)
    try {
      await api.atlasSetTailscaleSandboxAccess(teamId, connectorId, nextEnabled, tag)
      setEnabled(nextEnabled)
    } catch (e) {
      toast.apiError('Could not update private network access', e)
    } finally {
      setSaving(false)
    }
  }

  const generate = async () => {
    if (!TAG_PATTERN.test(targetTag)) {
      toast.error('Enter a target tag like tag:staging')

      return
    }
    if (recorderTag && !TAG_PATTERN.test(recorderTag)) {
      toast.error('Enter a recorder tag like tag:tsrecorder, or leave it empty')

      return
    }
    setGenerating(true)
    try {
      setSnippet(
        await api.atlasGenerateTailscaleAclSnippet(
          teamId,
          connectorId,
          targetTag,
          [sshUser],
          recorderTag || undefined,
        ),
      )
    } catch (e) {
      toast.apiError('Could not generate the ACL snippet', e)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="mt-5 rounded-lg border border-zGray-800">
      <div className="flex items-start gap-4 px-4 py-3.5 border-b border-zGray-800/60">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-main">Private network access</div>
          <div className="mt-1 text-[11.5px] text-tertiary leading-relaxed">
            Lets an agent sandbox join your tailnet as a short-lived node so it can reach machines
            with no public SSH. The node advertises the tag below and disappears when the session
            ends — what it may reach is decided entirely by your tailnet ACL.
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={saving || (!enabled && !tagValid)}
          onChange={(next) => void save(next)}
          label="Private network access"
        />
      </div>

      <div className="flex items-start gap-3 px-4 py-3 border-b border-zGray-800/60 bg-zGray-850/40">
        <ShieldAlert
          className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-zOrangered-400"
          strokeWidth={2}
        />
        <div className="text-[11.5px] text-secondary leading-relaxed">
          This is a larger grant than listing devices. If this OAuth client also carries
          device-write scopes, consider binding a separate client that only has{' '}
          <span className="font-mono text-[11px]">auth_keys</span>, so the credential Nuphos holds
          for the data plane can do nothing else.
        </div>
      </div>

      <div className="flex items-center gap-4 px-4 py-3 border-b border-zGray-800/60">
        <div className="w-32 flex-shrink-0 text-[12px] text-tertiary">Sandbox tag</div>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value.trim())}
          spellCheck={false}
          placeholder="tag:nuphos"
          className="flex-1 min-w-0 h-7 px-2 rounded-md bg-zGray-850 border border-zGray-800 font-mono text-[12px] text-main outline-none focus:border-zGray-700"
        />
        {enabled && (
          <button
            type="button"
            disabled={saving || !tagValid}
            onClick={() => void save(true)}
            className="h-7 px-2.5 rounded-md bg-zGray-850 hover:bg-zGray-800 disabled:opacity-50 text-secondary hover:text-main text-[12px] font-medium"
          >
            Save
          </button>
        )}
      </div>

      <div className="px-4 py-3.5">
        <div className="text-[12px] font-medium text-main">Tailnet ACL</div>
        <div className="mt-1 text-[11.5px] text-tertiary leading-relaxed">
          Nuphos never writes your policy file. Generate the blocks below, review them, and apply
          them yourself — deleting them revokes access immediately.
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={targetTag}
            onChange={(e) => setTargetTag(e.target.value.trim())}
            spellCheck={false}
            placeholder="tag:staging"
            className="w-44 h-7 px-2 rounded-md bg-zGray-850 border border-zGray-800 font-mono text-[12px] text-main outline-none focus:border-zGray-700"
          />
          <input
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value.trim())}
            spellCheck={false}
            placeholder="deploy"
            className="w-32 h-7 px-2 rounded-md bg-zGray-850 border border-zGray-800 font-mono text-[12px] text-main outline-none focus:border-zGray-700"
          />
          <input
            value={recorderTag}
            onChange={(e) => setRecorderTag(e.target.value.trim())}
            spellCheck={false}
            placeholder="tag:tsrecorder (optional)"
            title="Tag of your session recorder. Set it to record every session and refuse connections when the recorder is down."
            className="w-52 h-7 px-2 rounded-md bg-zGray-850 border border-zGray-800 font-mono text-[12px] text-main outline-none focus:border-zGray-700"
          />
          <button
            type="button"
            disabled={generating}
            onClick={() => void generate()}
            className="h-7 px-2.5 rounded-md bg-zGray-850 hover:bg-zGray-800 disabled:opacity-50 text-secondary hover:text-main text-[12px] font-medium"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {snippet && (
          <div className="mt-3 relative">
            <pre className="max-h-72 overflow-auto scrollbar-thin rounded-md bg-zGray-900 border border-zGray-800 p-3 font-mono text-[11.5px] text-secondary leading-relaxed">
              {snippet}
            </pre>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(snippet)
                toast.success('ACL snippet copied')
              }}
              className="absolute top-2 right-2 h-6 px-2 rounded-md bg-zGray-850 hover:bg-zGray-800 text-tertiary hover:text-main text-[11px] font-medium flex items-center gap-1"
            >
              <Copy className="w-3 h-3" strokeWidth={2} />
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
