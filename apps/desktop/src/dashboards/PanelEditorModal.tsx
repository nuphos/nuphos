import { Dialog } from '@base-ui/react/dialog'
import { Loader2, X } from 'lucide-react'
import { useState } from 'react'

import { CredentialSelectorButton } from '../components/agent/panel/CredentialSelectorButton'
import {
  countSelectedCredentials,
  countTotalCredentials,
} from '../components/agent/panel/credentialSelectorButtonCounts'

import { usePanelCredentials } from './usePanelCredentials'

import type { DashboardPanel, DashboardPanelKind } from './schema'
import type { AgentCredentialSelection } from '../api'

const STARTERS: Record<DashboardPanelKind, string> = {
  chart: `// Globals: params, nuphos (calls Nuphos APIs as you), emit(payload).
// Emit a ChartPayload-shaped object.
const rows = [
  { date: '2026-07-01', usd: 120 },
  { date: '2026-07-02', usd: 138 },
];
emit({
  kind: 'chart',
  type: 'area',
  title: 'Daily spend',
  xKey: 'date',
  series: [{ key: 'usd', label: 'USD' }],
  data: rows,
});
`,
  scalar: `// Emit a single number (e.g. total spend — this is just a panel).
emit({ kind: 'scalar', title: 'Total spend', value: 17442, unit: 'usd', deltaPct: 14.6 });
`,
  table: `emit({
  kind: 'table',
  title: 'By service',
  columns: [{ key: 'name' }, { key: 'usd', label: 'USD', numeric: true }],
  rows: [{ name: 'cpx32', usd: 970 }, { name: 'cpx22', usd: 540 }],
});
`,
}

type Props = {
  teamId: string
  panel?: DashboardPanel | null
  saving?: boolean
  onCancel: () => void
  onSave: (input: {
    title: string
    kind: DashboardPanelKind
    code: string
    credentialAccess?: AgentCredentialSelection
  }) => void
}

export function PanelEditorModal({ teamId, panel, saving, onCancel, onSave }: Props) {
  const editing = !!panel
  const [title, setTitle] = useState(panel?.title ?? '')
  const [kind, setKind] = useState<DashboardPanelKind>(panel?.kind ?? 'chart')
  const [code, setCode] = useState(panel?.code ?? STARTERS.chart)
  const credentials = usePanelCredentials(teamId, panel)

  const canSave =
    title.trim().length > 0 &&
    code.trim().length > 0 &&
    (editing || !Object.values(STARTERS).includes(code)) &&
    !saving

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        {/* z-[1000]+ is the app's popup tier: `[data-base-ui-inert]` gets
            `z-index: 999` in index.css, which includes Base UI's fixed
            full-screen internal backdrop. Anything below 999 renders under it,
            so every click lands on the backdrop (= outside press). */}
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/50" />
        <Dialog.Viewport className="fixed inset-0 z-[1001] flex items-center justify-center p-6">
          <Dialog.Popup className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zGray-800 bg-zGray-950 shadow-2xl outline-none">
            <div className="flex items-center justify-between border-b border-zGray-800 px-4 py-3">
              <Dialog.Title className="text-[14px] font-medium text-main">
                {editing ? 'Edit panel' : 'New panel'}
              </Dialog.Title>
              <Dialog.Close
                className="rounded p-1 text-tertiary hover:bg-zGray-800 hover:text-main"
                aria-label="Close panel editor"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 py-3">
              <div className="flex gap-3">
                <label className="flex-1">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-tertiary">
                    Title
                  </span>
                  <input
                    className="w-full rounded-md border border-zGray-800 bg-zGray-900 px-2.5 py-1.5 text-[13px] text-main outline-none focus:border-zViolet-500"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Hetzner cost overview"
                  />
                </label>
                <label className="w-36">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-tertiary">
                    Kind
                  </span>
                  <select
                    className="w-full rounded-md border border-zGray-800 bg-zGray-900 px-2.5 py-1.5 text-[13px] text-main outline-none focus:border-zViolet-500"
                    value={kind}
                    onChange={(e) => {
                      const next = e.target.value as DashboardPanelKind

                      setKind(next)
                      // Swap the starter only if the code is still an untouched starter.
                      if (!editing && Object.values(STARTERS).includes(code))
                        setCode(STARTERS[next])
                    }}
                  >
                    <option value="chart">Chart</option>
                    <option value="scalar">Scalar</option>
                    <option value="table">Table</option>
                  </select>
                </label>
              </div>
              <label className="flex flex-1 flex-col">
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-tertiary">
                  Script (JavaScript)
                </span>
                <textarea
                  className="min-h-[280px] flex-1 resize-none rounded-md border border-zGray-800 bg-zGray-900 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-main outline-none focus:border-zViolet-500"
                  value={code}
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <div className="flex items-center gap-2">
                <CredentialSelectorButton
                  {...credentials.control}
                  hero={false}
                  positionerClassName="!z-[1100]"
                />
                <span className="text-[12px] text-secondary">
                  Credentials: {countSelectedCredentials(credentials.control.value)}/
                  {countTotalCredentials(credentials.control.options)} selected
                  {credentials.usesDefault ? ' · same default as a new conversation' : ''}
                </span>
              </div>
              <p className="text-[11px] text-tertiary">
                Runs on one of your team's online agents when created, refreshed, or on the
                dashboard's auto-refresh schedule. Available globals:{' '}
                <code className="text-secondary">params</code>,{' '}
                <code className="text-secondary">nuphos</code> (read-only Nuphos APIs as the script
                author, limited to the credentials selected above), and{' '}
                <code className="text-secondary">emit(payload)</code>. Editing the script creates a
                new version; old snapshots keep theirs.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-zGray-800 px-4 py-3">
              <Dialog.Close className="rounded-md px-3 py-1.5 text-[13px] text-secondary hover:bg-zGray-800">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md bg-zViolet-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-zViolet-400 disabled:opacity-50"
                disabled={!canSave}
                onClick={() =>
                  onSave({
                    title: title.trim(),
                    kind,
                    code,
                    ...(credentials.changedSelection
                      ? { credentialAccess: credentials.changedSelection }
                      : {}),
                  })
                }
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editing ? 'Save & run' : 'Create & run'}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
