import { DetailBlock } from './DetailBlocks'

import type { AgentMemoryItem } from '../../api'

export function GeneDetail({ gene }: { gene: NonNullable<AgentMemoryItem['gene']> }) {
  return (
    <>
      <DetailBlock label="Strategy">
        <div className="text-main leading-relaxed">{gene.title}</div>
      </DetailBlock>
      {gene.triggerSignals.length > 0 && (
        <DetailBlock label="Signals">
          <div className="flex flex-wrap gap-1.5">
            {gene.triggerSignals.map((s, i) => (
              <span key={i} className="px-2 py-1 rounded-md bg-zGray-850 text-secondary">
                {s}
              </span>
            ))}
          </div>
        </DetailBlock>
      )}
      {gene.investigationPath.length > 0 && (
        <DetailBlock label="Investigation path">
          <ol className="space-y-2">
            {gene.investigationPath.map((step, i) => (
              <li key={i} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
                <span className="text-tertiary font-mono text-[11.5px]">{i + 1}.</span>
                <span className="text-main leading-relaxed">
                  {step.action} <span className="text-tertiary">→ {step.check}</span>
                  {step.nextWhen ? (
                    <span className="text-quaternary"> (next when: {step.nextWhen})</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </DetailBlock>
      )}
      {gene.traps.length > 0 && (
        <DetailBlock label="Traps">
          <ul className="space-y-1 list-disc pl-4">
            {gene.traps.map((t, i) => (
              <li key={i} className="text-main leading-relaxed">
                {t}
              </li>
            ))}
          </ul>
        </DetailBlock>
      )}
      {gene.doNotUseWhen.length > 0 && (
        <DetailBlock label="Do not use when">
          <ul className="space-y-1 list-disc pl-4">
            {gene.doNotUseWhen.map((d, i) => (
              <li key={i} className="text-main leading-relaxed">
                {d}
              </li>
            ))}
          </ul>
        </DetailBlock>
      )}
      {(gene.capsules?.length ?? 0) > 0 && (
        <DetailBlock label={`Evidence (${String(gene.capsules!.length)})`}>
          <div className="space-y-2.5">
            {gene.capsules!.map((c, i) => (
              <div
                key={i}
                className="rounded-md border border-zGray-800/60 bg-zGray-850 p-2.5 space-y-1.5"
              >
                <div className="flex items-center gap-1.5 text-xs text-tertiary uppercase tracking-wide">
                  <span>{c.outcome}</span>
                  <span>·</span>
                  <span className="normal-case">{new Date(c.observedAt).toLocaleDateString()}</span>
                  {c.planId && <span className="normal-case">· plan #{c.planId}</span>}
                </div>
                <div className="text-main leading-relaxed">{c.problem}</div>
                {c.rootCause && (
                  <div className="text-secondary leading-relaxed">Root cause: {c.rootCause}</div>
                )}
                {c.actions.length > 0 && (
                  <div>
                    <div className="text-xs text-tertiary uppercase tracking-wide">Actions</div>
                    <ul className="space-y-1 list-disc pl-4">
                      {c.actions.map((a, j) => (
                        <li key={j} className="text-secondary leading-relaxed">
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.verification.length > 0 && (
                  <div>
                    <div className="text-xs text-tertiary uppercase tracking-wide">Verified by</div>
                    <ul className="space-y-1 list-disc pl-4">
                      {c.verification.map((v, j) => (
                        <li key={j} className="text-secondary leading-relaxed">
                          {v}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DetailBlock>
      )}
    </>
  )
}
