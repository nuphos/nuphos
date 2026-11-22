import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { DownloadGroups } from '../../src/components/agent/panel/DownloadGroups'
import { ArtifactView } from '../../src/views/ArtifactView'
import { ToastProvider } from '../../src/components/ui/ToastProvider'
import { workbookBytes } from './workbook.mjs'

const names = [
  'sample.xlsx',
  'report.md',
  'notes.txt',
  'broken.xlsx',
  'large.xlsx',
  'unknown.bin',
  'mime-only',
]
const group = {
  groupId: 'fixture',
  direction: 'download',
  status: 'ready',
  label: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  files: names.map((fileName, i) => ({
    id: String(i),
    fileName,
    relPath: fileName,
    size: i === 4 ? 6 * 1024 * 1024 : 512,
    status: 'ready',
    contentType:
      i === 6 ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : null,
  })),
}
const calls = []
Object.assign(window, {
  fixtureCalls: calls,
  api: {
    fileTransferReadOne: async (args) => {
      calls.push(['read', args])
      return args.fileId === '3' ? new Uint8Array([1, 2, 3]) : workbookBytes()
    },
    fileTransferReadText: async (args) => ({
      fileName: names[Number(args.fileId)],
      text:
        args.fileId === '1' ? '# Existing Markdown\n\nUnchanged preview.' : 'Existing plain text.',
    }),
    fileTransferDownloadOne: async (args) => {
      calls.push(['download', args])
      return { saved: false }
    },
  },
})
function App() {
  const [artifact, setArtifact] = useState('')
  useEffect(() => {
    const open = (e) => setArtifact(decodeURIComponent(e.detail.split('/').pop()))
    window.addEventListener('nuphos:open-in-app', open)
    return () => window.removeEventListener('nuphos:open-in-app', open)
  }, [])
  return (
    <ToastProvider>
      <main className="min-h-screen bg-surface p-6 text-main">
        <h1 className="mb-4 text-xl">XLSX attachment preview · isolated dummy workbook</h1>
        <div className="grid gap-5" style={{ gridTemplateColumns: '420px 1fr' }}>
          <section data-testid="card">
            <DownloadGroups teamId="fixture-team" channelId="fixture-channel" groups={[group]} />
          </section>
          <section
            data-testid="dock"
            style={{ height: 700 }}
            className="flex h-[700px] min-w-0 flex-col overflow-hidden rounded-xl border border-line-control"
          >
            {artifact ? (
              <ArtifactView
                key={artifact}
                artifactId={artifact}
                teamId="fixture-team"
                onAskAgent={() => undefined}
              />
            ) : (
              <p className="p-4">Select sample.xlsx</p>
            )}
          </section>
        </div>
      </main>
    </ToastProvider>
  )
}
createRoot(document.getElementById('root')).render(<App />)
