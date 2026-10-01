import { lambdaStateClass } from './lambda-helpers'
import { formatBytes } from './shared'

import type { AwsLambdaFunctionDetail } from '../../types'

export function LambdaOverviewPanel({ detail }: { detail: AwsLambdaFunctionDetail }) {
  const envEntries = Object.entries(detail.environment)

  return (
    <div className="flex-1 min-h-0 overflow-auto scrollbar-thin px-4 py-3">
      <dl className="grid grid-cols-[140px,1fr] gap-x-4 gap-y-1.5 text-[12px] max-w-3xl">
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">State</dt>
        <dd className={lambdaStateClass(detail.state)}>
          {detail.state ?? '—'}
          {detail.stateReason ? (
            <span className="text-tertiary"> — {detail.stateReason}</span>
          ) : null}
        </dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
          Last update
        </dt>
        <dd className="text-secondary">{detail.lastUpdateStatus ?? '—'}</dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
          Runtime
        </dt>
        <dd className="font-mono text-secondary">
          {detail.runtime ?? (detail.packageType === 'Image' ? 'container image' : '—')}
          {detail.architectures.length > 0 ? ` · ${detail.architectures.join(', ')}` : ''}
        </dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
          Handler
        </dt>
        <dd className="font-mono text-secondary">{detail.handler ?? '—'}</dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
          Resources
        </dt>
        <dd className="text-secondary">
          {detail.memoryMb != null ? `${String(detail.memoryMb)} MB memory` : '—'}
          {detail.timeoutSec != null ? ` · ${String(detail.timeoutSec)}s timeout` : ''}
          {detail.ephemeralStorageMb != null
            ? ` · ${String(detail.ephemeralStorageMb)} MB ephemeral`
            : ''}
        </dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
          Concurrency
        </dt>
        <dd className="text-secondary">
          {detail.reservedConcurrency != null
            ? `${String(detail.reservedConcurrency)} reserved`
            : 'Unreserved (account pool)'}
        </dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">Code</dt>
        <dd className="text-secondary">
          {formatBytes(detail.codeSizeBytes)}
          {detail.version ? ` · v${detail.version}` : ''}
          {detail.codeSha256 ? (
            <span className="font-mono text-[11px] text-tertiary break-all">
              {' '}
              · {detail.codeSha256}
            </span>
          ) : null}
        </dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">ARN</dt>
        <dd className="font-mono text-secondary break-all">{detail.arn}</dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
          Execution role
        </dt>
        <dd className="font-mono text-secondary break-all">{detail.roleArn ?? '—'}</dd>
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
          Log group
        </dt>
        <dd className="font-mono text-secondary break-all">{detail.logGroup}</dd>
        {detail.vpcSubnetIds.length > 0 && (
          <>
            <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
              VPC
            </dt>
            <dd className="font-mono text-secondary break-all">
              {detail.vpcSubnetIds.join(', ')}
              {detail.vpcSecurityGroupIds.length > 0
                ? ` · SG: ${detail.vpcSecurityGroupIds.join(', ')}`
                : ''}
            </dd>
          </>
        )}
        {detail.layers.length > 0 && (
          <>
            <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
              Layers
            </dt>
            <dd className="font-mono text-secondary break-all">
              {detail.layers.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </dd>
          </>
        )}
        {detail.description && (
          <>
            <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
              Description
            </dt>
            <dd className="text-secondary">{detail.description}</dd>
          </>
        )}
        <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
          Modified
        </dt>
        <dd className="text-secondary">{detail.lastModified ?? '—'}</dd>
      </dl>

      <div className="mt-4 max-w-3xl">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] text-tertiary uppercase tracking-wider">
            Environment variables
          </span>
          <span className="text-[11px] text-tertiary">({envEntries.length})</span>
        </div>
        {envEntries.length === 0 ? (
          <div className="text-[12px] text-tertiary italic">No environment variables.</div>
        ) : (
          <div className="border border-zGray-800 rounded bg-zGray-900 divide-y divide-zGray-850">
            {envEntries.map(([k, v]) => (
              <div
                key={k}
                className="px-2.5 py-1.5 grid grid-cols-[minmax(120px,max-content),1fr] gap-x-4 text-[11.5px] font-mono"
              >
                <span className="text-zViolet-accent break-all">{k}</span>
                <span className="text-secondary break-all">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
