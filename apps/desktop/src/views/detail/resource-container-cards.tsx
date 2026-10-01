import clsx from 'clsx'
import { Box } from 'lucide-react'

import type { ContainerSpecModel } from './resource-topology'
import type { ReactNode } from 'react'

function SmallFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] uppercase tracking-wider text-tertiary">{label}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-secondary">{children}</div>
    </div>
  )
}

export function ContainerSpecCards({ containers }: { containers: ContainerSpecModel[] }) {
  if (containers.length === 0) {
    return <div className="px-6 py-5 text-[12px] text-tertiary">No containers declared.</div>
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-4 @3xl:grid-cols-2">
      {containers.map((container) => (
        <article
          key={`${container.init ? 'init' : container.ephemeral ? 'ephemeral' : 'main'}:${container.name}`}
          className="min-w-0 rounded-lg border border-zGray-800 bg-zGray-900 p-3.5"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={clsx(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
                container.init
                  ? 'bg-zGray-800 text-secondary ring-zGray-700'
                  : 'bg-zViolet-500/10 text-zViolet-accent ring-zViolet-500/15',
              )}
            >
              <Box className="h-3.5 w-3.5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <h3 className="truncate text-[12.5px] font-semibold text-main">{container.name}</h3>
                {(container.init || container.ephemeral) && (
                  <span className="text-[10px] text-tertiary">
                    {container.init ? 'init' : 'ephemeral'}
                  </span>
                )}
              </div>
              <div
                className="truncate font-mono text-[10.5px] text-tertiary"
                title={container.image}
              >
                {container.image}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zGray-800 pt-3">
            <SmallFact label="CPU">
              {container.cpuRequest ?? '-'} req · {container.cpuLimit ?? '-'} limit
            </SmallFact>
            <SmallFact label="Memory">
              {container.memoryRequest ?? '-'} req · {container.memoryLimit ?? '-'} limit
            </SmallFact>
            <SmallFact label="Ports">
              {container.ports.length > 0 ? container.ports.join(', ') : '-'}
            </SmallFact>
            <SmallFact label="Health checks">
              {container.probes.length > 0 ? container.probes.join(', ') : 'None'}
            </SmallFact>
            <SmallFact label="Environment">
              {String(container.envCount)} vars · {String(container.envFromCount)} sources
            </SmallFact>
            <SmallFact label="Volume mounts">{String(container.mounts.length)}</SmallFact>
          </div>
        </article>
      ))}
    </div>
  )
}
