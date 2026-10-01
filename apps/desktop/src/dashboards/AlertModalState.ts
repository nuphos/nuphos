import { useEffect, useState } from 'react'

import { api } from '../api'
import { toast } from '../components/ui/toast'

import type {
  PanelAlertExtract,
  PanelAlertOp,
  DashboardPanel,
  DashboardPanelAlertChannel,
} from './schema'

export const EXTRACTS: { value: PanelAlertExtract; label: string; kinds: string[] }[] = [
  { value: 'scalar', label: 'Scalar value', kinds: ['scalar'] },
  { value: 'series-last', label: 'Latest series point', kinds: ['chart'] },
  { value: 'series-sum', label: 'Sum of a series', kinds: ['chart'] },
  { value: 'column-sum', label: 'Sum of a table column', kinds: ['table'] },
]
export const OPS: { value: PanelAlertOp; label: string }[] = [
  { value: 'gt', label: '> greater than' },
  { value: 'gte', label: '≥ at least' },
  { value: 'lt', label: '< less than' },
  { value: 'increase_pct', label: '% increase vs previous' },
]

export function useAlertEditor(
  teamId: string,
  dashboardId: string,
  panel: DashboardPanel,
  onClose: () => void,
) {
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [hasAlert, setHasAlert] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const defaultExtract: PanelAlertExtract =
    panel.kind === 'scalar' ? 'scalar' : panel.kind === 'table' ? 'column-sum' : 'series-last'
  const [extract, setExtract] = useState<PanelAlertExtract>(defaultExtract)
  const [ref, setRef] = useState('')
  const [op, setOp] = useState<PanelAlertOp>('gt')
  const [threshold, setThreshold] = useState('0')
  const [channelType, setChannelType] = useState<'slack' | 'discord' | 'email'>('slack')
  const [channelValue, setChannelValue] = useState('')
  // The API stores up to 10 delivery channels; this modal only edits the first.
  // Carry the rest through untouched so saving a threshold change here can't
  // silently delete destinations configured elsewhere.
  const [extraChannels, setExtraChannels] = useState<DashboardPanelAlertChannel[]>([])

  useEffect(() => {
    let cancelled = false

    api
      .dashboardsGetAlert(teamId, dashboardId, panel.id)
      .then((res) => {
        if (cancelled || !res.alert) return
        const a = res.alert

        setEnabled(a.enabled)
        setHasAlert(true)
        setExtract(
          EXTRACTS.some(
            (option) => option.value === a.metric.extract && option.kinds.includes(panel.kind),
          )
            ? a.metric.extract
            : defaultExtract,
        )
        setRef(a.metric.ref ?? '')
        setOp(a.condition.op)
        setThreshold(String(a.condition.threshold))
        const ch = a.channels[0]

        if (ch) {
          setChannelType(ch.type)
          setChannelValue(
            ch.type === 'slack'
              ? ch.channelId
              : ch.type === 'discord'
                ? ch.webhookUrl
                : ch.to.join(', '),
          )
        }
        setExtraChannels(a.channels.slice(1))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadFailed(true)
        toast.apiError('Could not load alert', err)
      })
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [teamId, dashboardId, panel.id, panel.kind, defaultExtract])

  const save = async () => {
    const thr = Number(threshold)

    if (!Number.isFinite(thr)) {
      toast.error('Threshold must be a number')

      return
    }
    let channel: DashboardPanelAlertChannel

    if (channelType === 'slack') channel = { type: 'slack', channelId: channelValue.trim() }
    else if (channelType === 'discord')
      channel = { type: 'discord', webhookUrl: channelValue.trim() }
    else
      channel = {
        type: 'email',
        to: channelValue
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }
    setSaving(true)
    try {
      await api.dashboardsSaveAlert(teamId, dashboardId, panel.id, {
        enabled,
        metric: { extract, ...(ref.trim() ? { ref: ref.trim() } : {}) },
        condition: { op, threshold: thr },
        channels: [channel, ...extraChannels],
      })
      toast.success('Alert saved')
      onClose()
    } catch (err) {
      toast.apiError('Could not save alert', err)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      await api.dashboardsDeleteAlert(teamId, dashboardId, panel.id)
      toast.success('Alert removed')
      setConfirmingRemove(false)
      onClose()
    } catch (err) {
      toast.apiError('Could not remove alert', err)
      throw err
    } finally {
      setSaving(false)
    }
  }

  return {
    loading,
    loadFailed,
    saving,
    confirmingRemove,
    setConfirmingRemove,
    hasAlert,
    enabled,
    setEnabled,
    extract,
    setExtract,
    ref,
    setRef,
    op,
    setOp,
    threshold,
    setThreshold,
    channelType,
    setChannelType,
    channelValue,
    setChannelValue,
    extraChannels,
    save,
    remove,
  }
}
