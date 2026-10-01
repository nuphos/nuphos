import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { reportFrontendError } from '../lib/frontendErrorReporter'
import { requestOpenPortForwardList } from '../lib/portForwardList'

import { CUSTOM_PORT_VALUE } from './port-forward/constants'
import { ActiveForwardPanel, PortForwardForm } from './port-forward/panels'
import { useResetOnKey } from './useResetOnKey'

import type { PodPort, PortForwardInfo } from '../types'

type Props = {
  open: boolean
  /**
   * The kubeconfig context to forward against. Passed in by the caller (not
   * read live from `useKubeContext`) so the dialog stays bound to the cluster
   * the row was opened from — if the user switches the tab's cluster while
   * the dialog is open, the port-forward still targets the original one.
   */
  context: string
  target: { kind: 'Pod' | 'Service'; namespace: string; name: string; ports: PodPort[] }
  onClose: () => void
}

export function PortForwardDialog({ open, context, target: forwardTarget, onClose }: Props) {
  const defaultTarget = forwardTarget.ports[0]?.port.toString() ?? ''
  const defaultSelection = defaultTarget || CUSTOM_PORT_VALUE
  const targetKey = [
    forwardTarget.kind,
    forwardTarget.namespace,
    forwardTarget.name,
    forwardTarget.ports
      .map((p) => `${p.name ?? ''}:${String(p.port)}:${p.protocol ?? ''}`)
      .join('|'),
  ].join('/')
  const [targetPortMode, setTargetPortMode] = useState<string>(defaultSelection)
  const [targetPort, setTargetPort] = useState<string>(defaultTarget)
  const [localPort, setLocalPort] = useState<string>('')
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle')
  const [activeInfo, setActiveInfo] = useState<PortForwardInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useResetOnKey(`${String(open)}|${targetKey}|${defaultSelection}|${defaultTarget}`, () => {
    if (!open) return
    setStatus('idle')
    setActiveInfo(null)
    setError(null)
    setCopied(false)
    setTargetPortMode(defaultSelection)
    setTargetPort(defaultTarget)
    setLocalPort('')
  })

  useEffect(() => {
    if (!open) return
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [open, targetKey, defaultSelection, defaultTarget])

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
    }
  }, [])

  function reset() {
    setStatus('idle')
    setActiveInfo(null)
    setError(null)
    setCopied(false)
    const nextDefaultTarget = forwardTarget.ports[0]?.port.toString() ?? ''

    setTargetPortMode(nextDefaultTarget || CUSTOM_PORT_VALUE)
    setTargetPort(nextDefaultTarget)
    setLocalPort('')
  }

  function handleTargetPortModeChange(value: string) {
    setTargetPortMode(value)
    if (value !== CUSTOM_PORT_VALUE) {
      setTargetPort(value)
    } else if (forwardTarget.ports.some((p) => p.port.toString() === targetPort)) {
      setTargetPort('')
    }
  }

  async function handleStart() {
    if (!targetPort || !/^\d+$/.test(targetPort)) {
      setError('Enter a valid target port (1–65535).')
      setStatus('error')

      return
    }
    const target = Number(targetPort)

    if (target < 1 || target > 65535) {
      setError('Enter a valid target port (1–65535).')
      setStatus('error')

      return
    }
    if (localPort && !/^\d+$/.test(localPort)) {
      setError('Enter a valid local port (1–65535) or leave blank for auto.')
      setStatus('error')

      return
    }
    const local = localPort ? Number(localPort) : 0

    if (localPort && (local < 1 || local > 65535)) {
      setError('Enter a valid local port (1–65535) or leave blank for auto.')
      setStatus('error')

      return
    }
    setStatus('connecting')
    setError(null)
    try {
      const info =
        forwardTarget.kind === 'Service'
          ? await api.k8sStartServicePortForward(
              context,
              forwardTarget.namespace,
              forwardTarget.name,
              target,
              local || 0,
            )
          : await api.k8sStartPortForward(
              context,
              forwardTarget.namespace,
              forwardTarget.name,
              target,
              local || 0,
            )

      setActiveInfo(info)
      setStatus('active')
      handleClose()
      requestOpenPortForwardList()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  async function handleStop() {
    if (!activeInfo) return
    try {
      await api.k8sStopPortForward(activeInfo.id)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  function handleClose() {
    onClose()
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(reset, 300)
  }

  async function handleCopy() {
    if (!activeInfo) return
    try {
      await navigator.clipboard.writeText(`localhost:${String(activeInfo.localPort)}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error('[port-forward] copy failed:', e)
      reportFrontendError(
        {
          source: 'clipboard',
          phase: 'port_forward_address',
          message: 'Failed to copy local address.',
        },
        e,
      )
      setError('Failed to copy local address.')
      setStatus('error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`${forwardTarget.kind} port forward`}
      width={440}
    >
      <div className="px-5 py-4 flex flex-col gap-4">
        {status === 'idle' || status === 'error' ? (
          <PortForwardForm
            ports={forwardTarget.ports}
            targetPortMode={targetPortMode}
            onTargetPortModeChange={handleTargetPortModeChange}
            targetPort={targetPort}
            onTargetPortChange={setTargetPort}
            localPort={localPort}
            onLocalPortChange={setLocalPort}
            error={error}
          />
        ) : status === 'connecting' ? (
          <div className="flex items-center gap-2 text-[13px] text-secondary py-2">
            <Loader2 className="w-4 h-4 animate-spin text-zViolet-accent" />
            Connecting…
          </div>
        ) : (
          <ActiveForwardPanel
            kind={forwardTarget.kind}
            activeInfo={activeInfo}
            copied={copied}
            onCopy={() => void handleCopy()}
          />
        )}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800 bg-zGray-900/60">
        {status === 'active' ? (
          <>
            <button
              onClick={() => void handleStop()}
              className="h-8 px-3 rounded-md text-[12.5px] text-error hover:bg-error/10 hover:text-error transition-colors"
            >
              Stop
            </button>
            <button
              onClick={handleClose}
              className="h-8 px-3 rounded-md text-[12.5px] bg-zViolet-500 hover:bg-zViolet-400 text-white font-medium transition-colors"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleClose}
              disabled={status === 'connecting'}
              className="h-8 px-3 rounded-md text-[12.5px] text-secondary hover:text-main hover:bg-zGray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleStart()}
              disabled={status === 'connecting'}
              className="h-8 px-3 rounded-md text-[12.5px] bg-zViolet-500 hover:bg-zViolet-400 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'connecting' ? 'Connecting…' : 'Start forwarding'}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
