import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { Modal } from '../../components/Modal'
import { AppSelect } from '../../components/ui/select'
import { JsonEditor } from '../../components/YamlEditor'

import { ExecutorsPicker, Field } from './ChangesCommon'
import { buildStatement, inputClass, OPERATIONS, textareaClass } from './changesStatement'

import type { Operation } from './changesStatement'
import type {
  DatabaseChangeRequest,
  DatabaseChangeRequestInput,
  DatabaseConnection,
  TeamMember,
} from '../../types'

export function CreateChangeDialog({
  open,
  teamId,
  currentUserId,
  connection,
  members,
  onClose,
  onCreated,
}: {
  open: boolean
  teamId: string
  currentUserId: string
  connection: DatabaseConnection
  members: TeamMember[]
  onClose: () => void
  onCreated: (change: DatabaseChangeRequest) => void
}) {
  const [operation, setOperation] = useState<Operation>('updateOne')
  const [title, setTitle] = useState('')
  const [database, setDatabase] = useState(connection.databaseName ?? 'nuphos_demo')
  const [collection, setCollection] = useState('customers')
  const [filter, setFilter] = useState('{\n  "customerNo": "CUS-0001"\n}')
  const [payload, setPayload] = useState('{\n  "$set": {\n    "status": "active"\n  }\n}')
  const [indexName, setIndexName] = useState('')
  const [unique, setUnique] = useState(false)
  const [sparse, setSparse] = useState(false)
  const [description, setDescription] = useState('')
  const [risk, setRisk] = useState('')
  const [rollbackPlan, setRollbackPlan] = useState('')
  const [executors, setExecutors] = useState<string[]>([currentUserId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  async function create() {
    if (!title.trim() || !description.trim() || !risk.trim() || !rollbackPlan.trim())
      return setError('Title, purpose, risk, and rollback plan are required.')
    setBusy(true)
    setError(null)
    try {
      const input: DatabaseChangeRequestInput = {
        title: title.trim(),
        description: description.trim(),
        risk: risk.trim(),
        rollbackPlan: rollbackPlan.trim(),
        statement: buildStatement({
          operation,
          database,
          collection,
          filter,
          payload,
          indexName,
          unique,
          sparse,
        }),
        authorizedExecutorUserIds: executors,
        expiresAt: null,
      }

      onCreated(await api.atlasCreateDatabaseChangeRequest(teamId, connection.id, input))
    } catch (cause) {
      setError(parseAtlasError(cause).message)
    } finally {
      setBusy(false)
    }
  }

  const needsFilter = operation.startsWith('update') || operation.startsWith('delete')
  const needsPayload =
    operation.startsWith('insert') || operation.startsWith('update') || operation === 'createIndex'
  const needsIndexName = operation === 'createIndex' || operation === 'dropIndex'

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title="New MongoDB change Plan"
      description="Propose a team-scoped Plan. Approval and authorized execution remain separate actions."
      width={760}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <button
            disabled={busy}
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-secondary"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={() => void create()}
            className="rounded-md bg-zViolet-500 px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
          >
            {busy ? 'Proposing…' : 'Propose Plan'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              placeholder="Activate trial customers"
            />
          </Field>
          <Field label="Operation">
            <AppSelect
              value={operation}
              onValueChange={(value) => setOperation(value as Operation)}
              ariaLabel="Change operation"
              triggerClassName="h-8 w-full border-zGray-800 bg-field px-2.5 text-[12.5px]"
              options={OPERATIONS.map((item) => ({
                value: item.value,
                label: `${item.kind} · ${item.label}`,
              }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Database">
            <input
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Collection">
            <input
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        {needsFilter && (
          <Field label="Filter (Extended JSON)">
            <JsonEditor
              value={filter}
              onChange={setFilter}
              minimap={false}
              className="h-40 overflow-hidden rounded-md border border-zGray-800"
            />
          </Field>
        )}
        {needsPayload && (
          <Field
            label={
              operation === 'createIndex'
                ? 'Index keys (Extended JSON)'
                : operation === 'insertMany'
                  ? 'Documents (Extended JSON array)'
                  : operation.startsWith('insert')
                    ? 'Document (Extended JSON)'
                    : 'Update operators (Extended JSON)'
            }
          >
            <JsonEditor
              value={payload}
              onChange={setPayload}
              minimap={false}
              className="h-48 overflow-hidden rounded-md border border-zGray-800"
            />
          </Field>
        )}
        {needsIndexName && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={operation === 'dropIndex' ? 'Index name' : 'Index name (optional)'}>
              <input
                value={indexName}
                onChange={(e) => setIndexName(e.target.value)}
                className={inputClass}
              />
            </Field>
            {operation === 'createIndex' && (
              <div className="flex items-end gap-4 pb-2 text-[11.5px] text-secondary">
                <label>
                  <input
                    type="checkbox"
                    checked={unique}
                    onChange={(e) => setUnique(e.target.checked)}
                  />{' '}
                  Unique
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={sparse}
                    onChange={(e) => setSparse(e.target.checked)}
                  />{' '}
                  Sparse
                </label>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Purpose">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={textareaClass}
            />
          </Field>
          <Field label="Risk">
            <textarea
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className={textareaClass}
            />
          </Field>
          <Field label="Rollback plan">
            <textarea
              value={rollbackPlan}
              onChange={(e) => setRollbackPlan(e.target.value)}
              className={textareaClass}
            />
          </Field>
        </div>
        <Field
          label="Authorized executors"
          hint="You are always included. Approval alone never adds an executor."
        >
          <ExecutorsPicker
            members={members}
            currentUserId={currentUserId}
            executors={executors}
            onChange={setExecutors}
          />
        </Field>
        {(operation === 'deleteMany' || operation === 'dropCollection') && (
          <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-[11px] text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            This is a high-risk operation. The gateway requires a bounded target and explicit
            approval, but the database account remains the final permission boundary.
          </div>
        )}
        {error && (
          <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-[11.5px] text-error">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
