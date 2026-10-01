import { useCallback, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import type { AgentCredentialSelection } from '../../api'
import type {
  DashboardViewRange,
  NuphosDashboardDetail,
  DashboardPanel,
  DashboardPanelKind,
} from '../schema'
import type { Dispatch, RefObject, SetStateAction } from 'react'

type Args = {
  teamId: string
  viewRange?: DashboardViewRange
  selectedId: string | null
  detail: NuphosDashboardDetail | null
  setDetail: Dispatch<SetStateAction<NuphosDashboardDetail | null>>
  editor: { panel: DashboardPanel | null } | null
  setEditor: Dispatch<SetStateAction<{ panel: DashboardPanel | null } | null>>
  setPanelToDelete: Dispatch<SetStateAction<DashboardPanel | null>>
  panels: DashboardPanel[]
  dragFromRef: RefObject<number | null>
  loadDetail: (id: string, opts?: { silent?: boolean }) => Promise<void>
}

export function usePanelActions({
  teamId,
  viewRange,
  selectedId,
  detail,
  setDetail,
  editor,
  setEditor,
  setPanelToDelete,
  panels,
  dragFromRef,
  loadDetail,
}: Args) {
  const [busyPanels, setBusyPanels] = useState<Set<string>>(new Set())
  const [regenPanels, setRegenPanels] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const executePanel = useCallback(
    async (panel: DashboardPanel) => {
      if (!selectedId) return
      setBusyPanels((s) => new Set(s).add(panel.id))
      try {
        await api.dashboardsExecutePanel(teamId, selectedId, panel.id, true, viewRange)
        await loadDetail(selectedId)
      } catch (err) {
        toast.apiError('Panel run failed', err)
      } finally {
        setBusyPanels((s) => {
          const n = new Set(s)

          n.delete(panel.id)

          return n
        })
      }
    },
    [teamId, selectedId, loadDetail, viewRange],
  )

  // `PanelCard` / `InsightsSection` are memoized and take `() => void` props;
  // these adapters drop the promise exactly like passing the async callback
  // did, without handing the children a new identity every render.
  const onExecutePanel = useCallback(
    (panel: DashboardPanel) => void executePanel(panel),
    [executePanel],
  )

  const deletePanel = useCallback(
    async (panel: DashboardPanel) => {
      if (!selectedId) return
      try {
        await api.dashboardsDeletePanel(teamId, selectedId, panel.id)
        setPanelToDelete(null)
        await loadDetail(selectedId)
      } catch (err) {
        toast.apiError('Could not delete panel', err)
        throw err
      }
    },
    [teamId, selectedId, loadDetail, setPanelToDelete],
  )

  const insightFeedback = useCallback(
    async (panel: DashboardPanel, rating: 'up' | 'down') => {
      if (!selectedId) return
      try {
        await api.dashboardsInsightFeedback(
          teamId,
          selectedId,
          panel.id,
          rating,
          undefined,
          viewRange,
        )
      } catch (err) {
        toast.apiError('Could not save feedback', err)
      }
    },
    [teamId, selectedId, viewRange],
  )

  const regenerateInsight = useCallback(
    async (panel: DashboardPanel) => {
      if (!selectedId) return
      setRegenPanels((s) => new Set(s).add(panel.id))
      try {
        await api.dashboardsGenerateInsight(teamId, selectedId, panel.id, viewRange)
        await loadDetail(selectedId)
      } catch (err) {
        toast.apiError('Could not generate insight', err)
      } finally {
        setRegenPanels((s) => {
          const n = new Set(s)

          n.delete(panel.id)

          return n
        })
      }
    },
    [teamId, selectedId, loadDetail, viewRange],
  )

  const onInsightFeedback = useCallback(
    (panel: DashboardPanel, rating: 'up' | 'down') => void insightFeedback(panel, rating),
    [insightFeedback],
  )

  const onRegenerateInsight = useCallback(
    (panel: DashboardPanel) => void regenerateInsight(panel),
    [regenerateInsight],
  )

  const savePanel = useCallback(
    async (input: {
      title: string
      kind: DashboardPanelKind
      code: string
      credentialAccess?: AgentCredentialSelection
    }) => {
      if (!selectedId || !editor) return
      setSaving(true)
      try {
        if (editor.panel) {
          await api.dashboardsUpdatePanel(teamId, selectedId, editor.panel.id, {
            title: input.title,
            kind: input.kind,
            code: input.code,
            ...(input.credentialAccess ? { credentialAccess: input.credentialAccess } : {}),
          })
          await api.dashboardsExecutePanel(teamId, selectedId, editor.panel.id, true, viewRange)
        } else {
          await api.dashboardsCreatePanel(teamId, selectedId, {
            title: input.title,
            kind: input.kind,
            code: input.code,
            ...(input.credentialAccess ? { credentialAccess: input.credentialAccess } : {}),
          })
        }
        setEditor(null)
        await loadDetail(selectedId)
      } catch (err) {
        toast.apiError('Could not save panel', err)
      } finally {
        setSaving(false)
      }
    },
    [teamId, selectedId, editor, loadDetail, setEditor, viewRange],
  )

  // Persist a new panel order after a drag-drop by rewriting the layout array.
  const commitOrder = useCallback(
    async (ordered: DashboardPanel[]) => {
      if (!selectedId || !detail) return
      const byId = new Map(detail.dashboard.layout.map((l) => [l.panelId, l]))
      const layout = ordered.map((p, i) => {
        const prev = byId.get(p.id)

        return { panelId: p.id, x: 0, y: i, w: prev?.w ?? 12, h: prev?.h ?? 8 }
      })

      setDetail({ ...detail, dashboard: { ...detail.dashboard, layout } })
      try {
        await api.dashboardsUpdate(teamId, selectedId, { layout })
      } catch (err) {
        toast.apiError('Could not save order', err)
        void loadDetail(selectedId)
      }
    },
    [teamId, selectedId, detail, loadDetail, setDetail],
  )

  const onDrop = useCallback(
    (to: number) => {
      const from = dragFromRef.current

      dragFromRef.current = null
      if (from === null || from === to) return
      const next = [...panels]
      const [moved] = next.splice(from, 1)

      next.splice(to, 0, moved)
      void commitOrder(next)
    },
    [panels, commitOrder, dragFromRef],
  )

  const movePanel = useCallback(
    (from: number, offset: -1 | 1) => {
      const to = from + offset

      if (to < 0 || to >= panels.length) return
      const next = [...panels]
      const [moved] = next.splice(from, 1)

      next.splice(to, 0, moved)
      void commitOrder(next)
    },
    [panels, commitOrder],
  )

  return {
    busyPanels,
    regenPanels,
    saving,
    onExecutePanel,
    deletePanel,
    onInsightFeedback,
    onRegenerateInsight,
    savePanel,
    onDrop,
    movePanel,
  }
}
