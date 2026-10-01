import { Info } from 'lucide-react'

import { AppSelect } from '../components/ui/select'
import { duplicateNotice } from '../lib/posthogConnections'
import { POSTHOG_REGION_LABELS } from '../types/posthog'

import { PosthogPermissionMatrix } from './PosthogPermissionMatrix'

import type {
  PosthogIntegration,
  PosthogPermissions,
  PosthogRegion,
  PosthogScopeCatalog,
} from '../types'

export type PosthogDialogKind = 'connect' | 'reconnect' | 'permissions'

const REGION_OPTIONS = (Object.keys(POSTHOG_REGION_LABELS) as PosthogRegion[]).map((value) => ({
  value,
  label: POSTHOG_REGION_LABELS[value],
}))

const INTRO: Record<Exclude<PosthogDialogKind, 'reconnect'>, string> = {
  connect:
    "Nuphos requests only the access you choose below. You pick which projects to share on PostHog's consent screen.",
  permissions:
    'PostHog asks you to approve the new permissions. The current grant stays active until PostHog approves the new one.',
}

export function FormStep({
  kind,
  label,
  onLabelChange,
  region,
  onRegionChange,
  duplicate,
  onEditDuplicate,
  catalog,
  permissions,
  onPermissionsChange,
}: {
  kind: PosthogDialogKind
  label: string
  onLabelChange: (value: string) => void
  region: PosthogRegion
  onRegionChange: (value: PosthogRegion) => void
  duplicate: PosthogIntegration | null
  onEditDuplicate: (integration: PosthogIntegration) => void
  catalog: PosthogScopeCatalog | null
  permissions: PosthogPermissions | null
  onPermissionsChange: (value: PosthogPermissions) => void
}) {
  if (kind === 'reconnect') {
    return (
      <p className="text-secondary text-[12.5px] leading-relaxed">
        PostHog asks you to approve access again. Nuphos requests the permissions this connection
        already has.
      </p>
    )
  }

  return (
    <>
      <p className="text-secondary text-[12.5px] leading-relaxed">{INTRO[kind]}</p>
      {kind === 'connect' && (
        <LabelAndRegion
          label={label}
          onLabelChange={onLabelChange}
          region={region}
          onRegionChange={onRegionChange}
        />
      )}
      {kind === 'connect' && duplicate && (
        <div className="flex items-start gap-2 rounded-md border border-zGray-800 bg-zGray-900/40 px-3 py-2 text-[12px] text-secondary">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zViolet-accent" />
          <div className="min-w-0 flex-1">
            {duplicateNotice(duplicate)}{' '}
            <button
              type="button"
              onClick={() => onEditDuplicate(duplicate)}
              className="text-zViolet-accent hover:underline"
            >
              Edit its permissions instead
            </button>
          </div>
        </div>
      )}
      {catalog && permissions ? (
        <PosthogPermissionMatrix
          catalog={catalog}
          value={permissions}
          onChange={onPermissionsChange}
        />
      ) : (
        <div className="text-[12px] text-tertiary">Loading permissions…</div>
      )}
    </>
  )
}

function LabelAndRegion({
  label,
  onLabelChange,
  region,
  onRegionChange,
}: {
  label: string
  onLabelChange: (value: string) => void
  region: PosthogRegion
  onRegionChange: (value: PosthogRegion) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <div className="text-[12px] text-secondary mb-1">Label</div>
        <input
          value={label}
          onChange={(event) => onLabelChange(event.target.value)}
          placeholder="production-analytics"
          autoFocus
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent"
        />
      </label>
      <div>
        <div className="text-[12px] text-secondary mb-1">Region</div>
        <AppSelect
          value={region}
          onValueChange={(value) => onRegionChange(value as PosthogRegion)}
          options={REGION_OPTIONS}
          ariaLabel="PostHog region"
        />
      </div>
    </div>
  )
}
