import yaml from 'js-yaml'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { t } from '../../i18n'

import { decodeHelmRelease } from './helm-release-model'
import { helmValuesAreVisible } from './helm-release-visibility'
import { Field, Section } from './shared'

import type { DetailTarget } from './target'

type HelmStorageObject = {
  kind?: string
  data?: { release?: string }
  metadata?: {
    name?: string
    namespace?: string
    creationTimestamp?: string
    labels?: Record<string, string>
  }
}

type DecodedRelease = Awaited<ReturnType<typeof decodeHelmRelease>>

function countManifestResources(manifest: string | undefined): number {
  if (!manifest) return 0
  let count = 0

  yaml.loadAll(manifest, (document) => {
    if (document) count += 1
  })

  return count
}

export function HelmReleaseOverview({
  target,
  yamlText,
}: {
  target: DetailTarget
  yamlText: string
}) {
  const doc = (yaml.load(yamlText) ?? {}) as HelmStorageObject
  const labels = doc.metadata?.labels ?? {}
  const payloadKey = `${doc.kind ?? ''}\0${doc.data?.release ?? ''}`
  const [decoded, setDecoded] = useState<{
    key: string
    release: DecodedRelease | null
    error: string | null
  }>({ key: '', release: null, error: null })
  const [revealedPayloadKey, setRevealedPayloadKey] = useState<string | null>(null)

  useEffect(() => {
    const stored = doc.data?.release

    if (!stored || !doc.kind) return
    let cancelled = false

    decodeHelmRelease(doc.kind, stored)
      .then((value) => {
        if (!cancelled) setDecoded({ key: payloadKey, release: value, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDecoded({
            key: payloadKey,
            release: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [doc.data?.release, doc.kind, payloadKey])

  const release = decoded.key === payloadKey ? decoded.release : null
  const decodeError = decoded.key === payloadKey ? decoded.error : null
  const manifestResources = countManifestResources(release?.manifest)
  const chart = release?.chart?.metadata
  const chartVersion = chart?.version ? ` ${chart.version}` : ''
  const showValues = helmValuesAreVisible(revealedPayloadKey, payloadKey)

  return (
    <div className="space-y-5 p-6">
      <Section>
        <Field
          label={t('Release')}
          value={release?.name ?? labels.name ?? target.displayName ?? '-'}
        />
        <Field
          label={t('Namespace')}
          value={release?.namespace ?? doc.metadata?.namespace ?? target.namespace ?? '-'}
        />
        <Field label={t('Revision')} value={String(release?.version ?? labels.version ?? '-')} />
        <Field label={t('Status')} value={release?.info?.status ?? labels.status ?? '-'} />
        <Field label={t('Chart')} value={chart?.name ? `${chart.name}${chartVersion}` : '-'} />
        <Field label={t('App version')} value={chart?.appVersion ?? '-'} />
      </Section>
      {release && (
        <Section>
          <Field label={t('Description')} value={release.info?.description ?? '-'} />
          <Field label={t('Manifest resources')} value={String(manifestResources)} />
          <Field label={t('Hooks')} value={String(release.hooks?.length ?? 0)} />
          <Field
            label={t('Configured values')}
            value={String(Object.keys(release.config ?? {}).length)}
          />
        </Section>
      )}
      <Section>
        <Field label={t('Storage kind')} value={doc.kind ?? '-'} />
        <Field label={t('Storage object')} value={doc.metadata?.name ?? target.name} />
      </Section>
      {release?.config && Object.keys(release.config).length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[11.5px] uppercase tracking-wider text-tertiary">
              {t('Release values')}
            </div>
            <button
              type="button"
              onClick={() => setRevealedPayloadKey(showValues ? null : payloadKey)}
              className="inline-flex items-center gap-1.5 rounded bg-zGray-800 px-2.5 py-1 text-[11.5px] text-secondary hover:text-main"
            >
              {showValues ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showValues ? t('Hide values') : t('Reveal values')}
            </button>
          </div>
          {showValues ? (
            <pre className="max-h-72 overflow-auto rounded-md border border-zGray-800 bg-zGray-900 p-3 text-[11.5px] text-secondary">
              {yaml.dump(release.config, { noRefs: true })}
            </pre>
          ) : (
            <div className="rounded-md border border-zGray-800 bg-zGray-900 p-3 text-[12px] text-tertiary">
              {t('Values are hidden because Helm configuration can contain credentials.')}
            </div>
          )}
        </div>
      )}
      {decodeError && (
        <div className="text-[12px] text-zAmber-400">
          {t('Release payload could not be decoded: {error}', { error: decodeError })}
        </div>
      )}
      <div className="text-[12px] text-tertiary">
        {t('The YAML tab shows the read-only Helm storage record for this release revision.')}
      </div>
    </div>
  )
}
