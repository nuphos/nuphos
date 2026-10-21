import { useId, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

/** Mounted only during the current sign-in; codes never enter persisted runtime state. */
export function ClaudeSignInCode() {
  const id = useId()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    const value = code

    setCode('')
    setSubmitting(true)
    try {
      await api.localRuntimeSubmitClaudeLoginCode(value)
    } catch {
      toast.error('Could not submit sign-in code', 'Try signing in again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label className="block text-sm text-secondary" htmlFor={id}>
        If Claude shows an authorization code, paste it here.
      </label>
      <input
        id={id}
        type="password"
        autoComplete="off"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="w-full rounded-md border border-zGray-700 bg-transparent px-3 py-2 outline-none focus:border-zViolet-500 focus:ring-1 focus:ring-zViolet-500"
      />
      <Button size="sm" type="submit" disabled={submitting || !code.trim()}>
        Submit code
      </Button>
    </form>
  )
}
