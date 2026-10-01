import {
  ArchiveRestore,
  Clock3,
  Database,
  FileCheck2,
  HardDrive,
  LockKeyhole,
  Search,
  Settings2,
  ShieldCheck,
} from 'lucide-react'

import type { DatabaseConnection } from '../types'
import type { ReactNode } from 'react'

type Props = {
  connection: DatabaseConnection
}

export function DatabaseBackupRestorePreview({ connection }: Props) {
  return (
    <PreviewShell
      issue="NUPS-364"
      icon={<ArchiveRestore className="h-4 w-4" />}
      title="MongoDB backup and restore"
      description={`Backup artifacts for ${connection.name} will run through a dedicated execution workflow; Query Console credentials will not be exposed or reused in the renderer.`}
      action={
        <button
          disabled
          className="flex items-center gap-1.5 rounded-md bg-zViolet-500 px-3 py-1.5 text-[11.5px] text-white opacity-40"
        >
          <HardDrive className="h-3.5 w-3.5" />
          Create backup
        </button>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <StatusPreview
          label="Executor"
          value="Not connected"
          detail="Private execution plane required"
        />
        <StatusPreview label="Schedule" value="Not configured" detail="Manual backup comes first" />
        <StatusPreview label="Artifacts" value="0" detail="Encrypted inventory" />
      </div>
      <section className="mt-4 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-950/35">
        <div className="grid grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr] border-b border-zGray-800 px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">
          <span>Backup</span>
          <span>Scope</span>
          <span>Size</span>
          <span>Status</span>
        </div>
        <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
          <ArchiveRestore className="h-7 w-7 text-zGray-600" />
          <div className="mt-3 text-[12.5px] text-secondary">
            No backup workflow is connected yet
          </div>
          <p className="mt-1 max-w-xl text-[10.5px] leading-4 text-tertiary">
            Future artifacts will show checksum, MongoDB version, encrypted storage location,
            retention, progress, and restore compatibility.
          </p>
        </div>
      </section>
      <PreviewFootnote icon={<ShieldCheck className="h-4 w-4" />}>
        Restore will require integrity and target preflight, impact preview, typed confirmation,
        approval, and an explicit authorized executor. It will never be triggered from the read-only
        query gateway.
      </PreviewFootnote>
    </PreviewShell>
  )
}

export function DatabaseParametersPreview({ connection }: Props) {
  return (
    <PreviewShell
      issue="NUPS-366"
      icon={<Settings2 className="h-4 w-4" />}
      title="MongoDB runtime parameters"
      description={`Read the effective parameter catalog for ${connection.name} here. Every parameter write will create a governed change request instead of executing directly.`}
      action={
        <button
          disabled
          className="flex items-center gap-1.5 rounded-md bg-zViolet-500 px-3 py-1.5 text-[11.5px] text-white opacity-40"
        >
          <FileCheck2 className="h-3.5 w-3.5" />
          Request change
        </button>
      }
    >
      <div className="rounded-xl border border-zViolet-500/25 bg-zViolet-500/5 p-3.5">
        <div className="flex items-start gap-2.5">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-zViolet-accent" />
          <div>
            <div className="text-[12px] font-medium text-main">
              Approval is mandatory for parameter writes
            </div>
            <p className="mt-1 text-[10.5px] leading-4 text-tertiary">
              The request will carry the typed value, normalized diff, target scope, restart
              requirement, reason, and risk. It must meet this database's minimum approval policy,
              then an authorized executor must run it from Changes.
            </p>
          </div>
        </div>
      </div>
      <section className="mt-4 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-950/35">
        <div className="flex items-center justify-between gap-3 border-b border-zGray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-zGray-800 bg-zGray-900 px-2.5 py-1.5 text-tertiary">
            <Search className="h-3.5 w-3.5" />
            <span className="text-[10.5px]">Search parameters</span>
          </div>
          <span className="whitespace-nowrap rounded border border-zGray-700 px-2 py-1 text-[10px] text-tertiary">
            Catalog not connected
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr] border-b border-zGray-800 px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">
          <span>Parameter</span>
          <span>Effective value</span>
          <span>Scope</span>
          <span>Mutability</span>
        </div>
        <div className="divide-y divide-zGray-800/70">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="grid grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr] items-center px-4 py-3"
            >
              <SkeletonLine width={row === 1 ? 'w-44' : 'w-36'} />
              <SkeletonLine width="w-20" />
              <SkeletonLine width="w-16" />
              <SkeletonLine width="w-24" />
            </div>
          ))}
        </div>
      </section>
      <PreviewFootnote icon={<Database className="h-4 w-4" />}>
        The initial catalog will use an explicit allowlist and distinguish dynamic,
        restart-required, startup-only, node, replica, and cluster parameters. Unknown or sensitive
        parameters remain read-only or hidden.
      </PreviewFootnote>
    </PreviewShell>
  )
}

function PreviewShell({
  issue,
  icon,
  title,
  description,
  action,
  children,
}: {
  issue: string
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-zGray-800 bg-zGray-900/30 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg border border-zGray-700 bg-zGray-900 p-2 text-zViolet-accent">
            {icon}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-medium text-main">{title}</h2>
              <span className="rounded-full border border-warning/30 bg-warning/5 px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-warning">
                Preview
              </span>
              <span className="font-mono text-[9.5px] text-tertiary">{issue}</span>
            </div>
            <p className="mt-1 max-w-3xl text-[11.5px] leading-5 text-tertiary">{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="rounded-xl border border-zGray-800 bg-zGray-900/20 p-4">{children}</div>
    </div>
  )
}

function StatusPreview({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-zGray-800 bg-zGray-950/35 p-3.5">
      <div className="text-[10px] uppercase tracking-wide text-tertiary">{label}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-secondary">
        <Clock3 className="h-3.5 w-3.5 text-zGray-600" />
        {value}
      </div>
      <div className="mt-1 text-[9.5px] text-tertiary">{detail}</div>
    </div>
  )
}

function PreviewFootnote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-zGray-800 bg-zGray-900/45 px-3 py-2.5 text-[10.5px] leading-4 text-tertiary">
      <span className="mt-0.5 shrink-0 text-success">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

function SkeletonLine({ width }: { width: string }) {
  return <span className={`block h-2 rounded-full bg-zGray-700/65 ${width}`} />
}
