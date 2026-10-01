import {
  faBolt,
  faDatabase,
  faHardDrive,
  faKey,
  faLayerGroup,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Cloud, Globe, KeyRound } from 'lucide-react'

import { api } from '../../api'
import { resourceListCacheKey, withResourceListCache } from '../../lib/resourceListCache'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'
import {
  CloudflareD1View,
  CloudflareDnsRecordsView,
  CloudflareKvView,
  CloudflarePagesView,
  CloudflareR2View,
  CloudflareWorkersView,
  CloudflareZonesView,
} from '../../views/CloudViews'
import { CloudflareIamPermissionsView } from '../../views/IamPermissionsView'

import type { ScopeRenderContext } from './context'

export function renderCloudflarePages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    filter,
    refreshKey,
    cloudflareDetail,
    setCloudflareDetail,
    onCount,
    onLoading,
    onPickCloudflareZone,
    renderActiveNavPage,
  } = ctx

  if (scope.kind === 'cloudflare-account') {
    if (active === 'cloudflare.iam') {
      return renderActiveNavPage(
        'IAM Settings',
        <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <CloudflareIamPermissionsView
          teamId={scope.teamId}
          accountId={scope.accountId}
          refreshKey={refreshKey}
          onLoading={onLoading}
        />,
      )
    }
    if (active === 'cloudflare.workers') {
      return renderActiveNavPage(
        'Workers',
        <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5 text-tertiary" />,
        <CloudflareWorkersView
          teamId={scope.teamId}
          accountId={scope.accountId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          detail={cloudflareDetail?.kind === 'worker' ? cloudflareDetail : null}
          setDetail={(d) => setCloudflareDetail(d ? { kind: 'worker', ...d } : null)}
        />,
      )
    }
    if (active === 'cloudflare.r2') {
      return renderActiveNavPage(
        'R2',
        <FontAwesomeIcon icon={faHardDrive} className="w-3.5 h-3.5 text-tertiary" />,
        <CloudflareR2View
          teamId={scope.teamId}
          accountId={scope.accountId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          detail={cloudflareDetail?.kind === 'r2' ? cloudflareDetail : null}
          setDetail={(d) => setCloudflareDetail(d ? { kind: 'r2', ...d } : null)}
        />,
      )
    }
    if (active === 'cloudflare.pages') {
      return renderActiveNavPage(
        'Pages',
        <FontAwesomeIcon icon={faLayerGroup} className="w-3.5 h-3.5 text-tertiary" />,
        <CloudflarePagesView
          teamId={scope.teamId}
          accountId={scope.accountId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          detail={cloudflareDetail?.kind === 'pages' ? cloudflareDetail : null}
          setDetail={(d) => setCloudflareDetail(d ? { kind: 'pages', ...d } : null)}
        />,
      )
    }
    if (active === 'cloudflare.d1') {
      return renderActiveNavPage(
        'D1',
        <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5 text-tertiary" />,
        <CloudflareD1View
          teamId={scope.teamId}
          accountId={scope.accountId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          detail={cloudflareDetail?.kind === 'd1' ? cloudflareDetail : null}
          setDetail={(d) => setCloudflareDetail(d ? { kind: 'd1', ...d } : null)}
        />,
      )
    }
    if (active === 'cloudflare.kv') {
      return renderActiveNavPage(
        'KV',
        <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5 text-tertiary" />,
        <CloudflareKvView
          teamId={scope.teamId}
          accountId={scope.accountId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          detail={cloudflareDetail?.kind === 'kv' ? cloudflareDetail : null}
          setDetail={(d) => setCloudflareDetail(d ? { kind: 'kv', ...d } : null)}
        />,
      )
    }

    return renderActiveNavPage(
      'Domains',
      <Globe className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CloudflareZonesView
        loader={withResourceListCache(
          resourceListCacheKey('cloudflare', [scope.teamId, scope.accountId, 'zones']),
          () => api.atlasListCloudflareZones(scope.teamId, scope.accountId),
        )}
        onPick={onPickCloudflareZone}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        getRowLink={(z) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/cloudflare/${encodeURIComponent(scope.accountId)}/zones/${encodeURIComponent(z.id)}`,
          )
        }
      />,
    )
  }

  if (scope.kind === 'cloudflare-zone') {
    return renderActiveNavPage(
      'DNS Records',
      <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CloudflareDnsRecordsView
        zoneName={scope.zoneName}
        recordLoader={withResourceListCache(
          resourceListCacheKey('cloudflare', [scope.teamId, scope.accountId, 'dns', scope.zoneId]),
          () => api.atlasListCloudflareDnsRecords(scope.teamId, scope.accountId, scope.zoneId),
        )}
        onCreate={(input) =>
          api.atlasCreateCloudflareDnsRecord(scope.teamId, scope.accountId, scope.zoneId, input)
        }
        onUpdate={(recordId, input) =>
          api.atlasUpdateCloudflareDnsRecord(
            scope.teamId,
            scope.accountId,
            scope.zoneId,
            recordId,
            input,
          )
        }
        onDelete={(recordId) =>
          api.atlasDeleteCloudflareDnsRecord(scope.teamId, scope.accountId, scope.zoneId, recordId)
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        getRowLink={(r) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/cloudflare/${encodeURIComponent(scope.accountId)}/zones/${encodeURIComponent(scope.zoneId)}/dns-records/${encodeURIComponent(r.id)}`,
          )
        }
      />,
    )
  }

  return undefined
}
