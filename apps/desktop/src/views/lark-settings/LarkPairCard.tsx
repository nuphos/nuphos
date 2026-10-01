import { faCheck, faCopy, faKey } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'

import type { LarkPairCode } from '../../types'

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()

  if (ms <= 0) return 'expired'
  const mins = Math.round(ms / 60000)

  return mins <= 1 ? 'in under a minute' : `in ${String(mins)} minutes`
}

export function LarkPairCard({
  pairCode,
  pairGenerating,
  pairCopied,
  onGenerate,
  onCopy,
}: {
  pairCode: LarkPairCode | null
  pairGenerating: boolean
  pairCopied: boolean
  onGenerate: () => Promise<void>
  onCopy: () => Promise<void>
}) {
  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-zGray-800/70 bg-surface">
      <div className="border-b border-zGray-800/60 px-4 py-3">
        <div className="text-[13px] font-medium text-main">Link your Lark account</div>
        <div className="mt-0.5 text-[12px] text-tertiary">
          Generate a code, then DM it to the Nuphos bot in Lark to link your Lark account to your
          Nuphos user. The agent then acts as you. Codes are single-use and expire shortly.
        </div>
      </div>
      <div className="px-4 py-4">
        {pairCode ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <code className="rounded-md border border-zGray-800 bg-zGray-950/60 px-3 py-2 font-mono text-[18px] tracking-[0.2em] text-main">
                {pairCode.code}
              </code>
              <button
                type="button"
                onClick={() => void onCopy()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zGray-800 px-3 text-[12.5px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main"
                title="Copy code"
              >
                <FontAwesomeIcon icon={pairCopied ? faCheck : faCopy} className="h-3 w-3" />
                {pairCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="text-[12.5px] text-tertiary">
              DM the Nuphos bot in Lark and send{' '}
              <span className="font-mono text-secondary">{pairCode.code}</span>. Expires{' '}
              {formatExpiry(pairCode.expiresAt)}.
            </div>
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={pairGenerating}
              className="self-start text-[12.5px] font-medium text-zViolet-400 transition-colors hover:text-zViolet-300 disabled:opacity-50"
            >
              Generate a new code
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={pairGenerating}
            className={clsx(
              'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium text-white transition-colors',
              pairGenerating
                ? 'cursor-default bg-zGray-700 text-tertiary'
                : 'bg-zViolet-500 hover:bg-zViolet-400',
            )}
          >
            <FontAwesomeIcon icon={faKey} className="h-3 w-3" />
            {pairGenerating ? 'Generating…' : 'Generate pairing code'}
          </button>
        )}
      </div>
    </div>
  )
}
