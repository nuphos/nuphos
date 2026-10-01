import { Check, Copy } from 'lucide-react'

import { AppSelect } from '../../components/ui/select'

import {
  CUSTOM_PORT_VALUE,
  LOCAL_PORT_INPUT_ID,
  TARGET_PORT_INPUT_ID,
  TARGET_PORT_SELECT_ID,
} from './constants'

import type { PodPort, PortForwardInfo } from '../../types'

export function PortForwardForm({
  ports,
  targetPortMode,
  onTargetPortModeChange,
  targetPort,
  onTargetPortChange,
  localPort,
  onLocalPortChange,
  error,
}: {
  ports: PodPort[]
  targetPortMode: string
  onTargetPortModeChange: (value: string) => void
  targetPort: string
  onTargetPortChange: (value: string) => void
  localPort: string
  onLocalPortChange: (value: string) => void
  error: string | null
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={TARGET_PORT_SELECT_ID} className="text-[12px] text-secondary font-medium">
            Target port
          </label>
          <div className="flex flex-col gap-2">
            <AppSelect
              id={TARGET_PORT_SELECT_ID}
              value={targetPortMode}
              onValueChange={onTargetPortModeChange}
              triggerClassName="h-8 bg-zGray-800 px-2 text-[13px]"
              options={[
                ...ports.map((p) => {
                  const named = p.name ? `${p.name} (${String(p.port)})` : String(p.port)
                  const protocol = p.protocol ? ` / ${p.protocol}` : ''

                  return { value: p.port.toString(), label: `${named}${protocol}` }
                }),
                { value: CUSTOM_PORT_VALUE, label: 'Custom' },
              ]}
            />
            {targetPortMode === CUSTOM_PORT_VALUE && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={TARGET_PORT_INPUT_ID} className="sr-only">
                  Custom target port
                </label>
                <input
                  id={TARGET_PORT_INPUT_ID}
                  type="text"
                  value={targetPort}
                  onChange={(e) => onTargetPortChange(e.target.value)}
                  placeholder="e.g. 8080"
                  className="h-8 px-2 rounded-md bg-field border border-zGray-700 text-[13px] text-main placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-zViolet-500"
                />
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={LOCAL_PORT_INPUT_ID} className="text-[12px] text-secondary font-medium">
            Local port
          </label>
          <input
            id={LOCAL_PORT_INPUT_ID}
            type="text"
            value={localPort}
            onChange={(e) => onLocalPortChange(e.target.value)}
            placeholder="auto"
            className="h-8 px-2 rounded-md bg-field border border-zGray-700 text-[13px] text-main placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-zViolet-500"
          />
        </div>
      </div>
      {error && <div className="text-[12.5px] text-error leading-snug">{error}</div>}
    </>
  )
}

export function ActiveForwardPanel({
  kind,
  activeInfo,
  copied,
  onCopy,
}: {
  kind: 'Pod' | 'Service'
  activeInfo: PortForwardInfo | null
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
        <span className="text-[13px] text-success font-medium">Forwarding</span>
      </div>
      <div className="flex items-center gap-2 bg-zGray-800 rounded-lg px-3 py-2">
        <span className="font-mono text-[13px] text-main flex-1">
          localhost:{activeInfo?.localPort}
        </span>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy to clipboard"
          className="w-6 h-6 flex items-center justify-center text-tertiary hover:text-main transition-colors"
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-success" strokeWidth={2} />
          ) : (
            <Copy className="w-3.5 h-3.5" strokeWidth={2} />
          )}
        </button>
        <span className="text-tertiary text-[12px] mx-1">→</span>
        <span className="font-mono text-[12px] text-secondary">
          {kind.toLowerCase()}:{activeInfo?.targetPort}
        </span>
      </div>
    </div>
  )
}
