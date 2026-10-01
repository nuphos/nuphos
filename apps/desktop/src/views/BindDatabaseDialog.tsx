import { Loader2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { AppSelect } from '../components/ui/select'
import { AGENT_POLICY_OPTIONS, RELEASED_DATABASE_ENGINE } from '../lib/databaseRelease'

import { friendlyDatabaseError } from './bind-database/errors'
import { Field, TestResultPanel } from './bind-database/form'
import { useResetOnKey } from './useResetOnKey'

import type {
  DatabaseAgentPolicy,
  DatabaseConnection,
  DatabaseConnectionInput,
  DatabaseConnectionTestResult,
} from '../types'

type Props = {
  open: boolean
  teamId: string
  onClose: () => void
  onBound: (connection: DatabaseConnection) => void
}

const fieldClass =
  'w-full rounded-md border border-zGray-800 bg-field px-2.5 py-1.5 text-[12.5px] text-main outline-none focus:border-zViolet-accent disabled:opacity-50'

export function BindDatabaseDialog({ open, teamId, onClose, onBound }: Props) {
  const [name, setName] = useState('')
  const engine = RELEASED_DATABASE_ENGINE
  const [connectionUri, setConnectionUri] = useState('')
  const [environment, setEnvironment] = useState('production')
  const [tags, setTags] = useState('')
  const [agentPolicy, setAgentPolicy] = useState<DatabaseAgentPolicy>('disabled')
  const [testing, setTesting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<DatabaseConnectionTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(String(open), () => {
    if (open) return
    setConnectionUri('')
    setTestResult(null)
    setError(null)
    setTesting(false)
    setSubmitting(false)
  })

  if (!open) return null

  const input = (): DatabaseConnectionInput => ({
    name: name.trim(),
    engine,
    connectionUri: connectionUri.trim(),
    environment: environment.trim(),
    tags: tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    networkMode: 'public',
    access: {
      // Database connections are always team resources. Fine-grained member
      // visibility can be adjusted later from the resource's Access page; it
      // is not a separate personal ownership mode.
      memberAllowList: ['*'],
      agentPolicy,
    },
    relations: [],
  })

  const validate = () => {
    if (!name.trim()) return 'Name is required.'
    if (!environment.trim()) return 'Environment is required.'
    if (!connectionUri.trim()) return 'Connection string is required.'

    return null
  }

  async function testConnection() {
    const validationError = validate()

    if (validationError) return setError(validationError)
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const value = input()
      const result = await api.atlasTestDatabaseConnectionInput(teamId, {
        engine: value.engine,
        connectionUri: value.connectionUri,
        networkMode: value.networkMode,
        tailscale: value.tailscale,
      })

      setTestResult(result)
    } catch (cause) {
      setError(friendlyDatabaseError(cause))
    } finally {
      setTesting(false)
    }
  }

  async function bind() {
    const validationError = validate()

    if (validationError) return setError(validationError)
    setSubmitting(true)
    setError(null)
    try {
      const connection = await api.atlasCreateDatabaseConnection(teamId, input())

      setConnectionUri('')
      setTestResult(null)
      onBound(connection)
    } catch (cause) {
      setError(friendlyDatabaseError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  function close() {
    if (testing || submitting) return
    setConnectionUri('')
    setTestResult(null)
    setError(null)
    onClose()
  }

  return (
    <Modal
      open
      onClose={close}
      title="Add database"
      description="Nuphos encrypts the credential in the backend and only returns redacted connection metadata."
      width={560}
      footer={
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <button
            onClick={() => void testConnection()}
            disabled={testing || submitting}
            className="rounded-md border border-zGray-700 px-3 py-1.5 text-[12.5px] text-secondary hover:text-main disabled:opacity-50"
          >
            {testing ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Testing…
              </span>
            ) : (
              'Test connection'
            )}
          </button>
          <div className="flex gap-2">
            <button
              onClick={close}
              disabled={testing || submitting}
              className="px-3 py-1.5 text-[12.5px] text-secondary hover:text-main disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void bind()}
              disabled={testing || submitting}
              className="rounded-md bg-zViolet-500 px-3 py-1.5 text-[12.5px] text-white hover:bg-zViolet-400 disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add database'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4 text-[13px]">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production API"
              className={fieldClass}
            />
          </Field>
          <Field label="Engine">
            <div className={`${fieldClass} cursor-default`}>MongoDB</div>
          </Field>
        </div>
        <Field
          label="Connection string"
          hint="Read-only and write-capable accounts are supported. Nuphos operations remain constrained by the access policy below. The value is cleared when this dialog closes."
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={connectionUri}
            onChange={(e) => {
              setConnectionUri(e.target.value)
              setTestResult(null)
            }}
            placeholder="mongodb+srv://user:••••@host/database"
            className={`${fieldClass} font-mono`}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Environment">
            <input
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              placeholder="production"
              className={fieldClass}
            />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="payments, primary"
              className={fieldClass}
            />
          </Field>
        </div>
        <div>
          <Field label="Agent access">
            <AppSelect
              value={agentPolicy}
              onValueChange={(value) => setAgentPolicy(value as DatabaseAgentPolicy)}
              ariaLabel="Agent access policy"
              triggerClassName="h-8 w-full border-zGray-800 bg-field px-2.5 text-[12.5px]"
              options={AGENT_POLICY_OPTIONS}
            />
          </Field>
        </div>
        <div className="rounded-lg border border-zGray-800 bg-zGray-900/60 p-3 text-[12px] text-secondary">
          <div className="flex items-center gap-2 text-main">
            <ShieldCheck className="h-4 w-4 text-success" />
            Public network via backend proxy
          </div>
          <div className="mt-1 text-tertiary">
            The backend connects directly to the redacted endpoint using the encrypted credential.
            Credentials never enter the desktop or Agent sandbox.
          </div>
        </div>
        {testResult && <TestResultPanel testResult={testResult} />}
        {error && (
          <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
