import { useState } from 'react'

import { Button } from '../components/ui/button'
import { InputGroup, InputGroupInput } from '../components/ui/input-group'

/** noVNC's credentials; `target` is only for XVP, which a Mac does not use. */
export type MacAccount = { username: string; password: string; target: '' }

const FIELD = 'flex h-8 items-center rounded-lg border border-zGray-800/60 px-2.5'
const CONTROL = 'text-[13px] text-main placeholder:text-tertiary'

/** A Mac's Screen Sharing asks for an account on that Mac before it shows the screen. */
export function MacSignIn({
  failed,
  onSubmit,
}: {
  failed: boolean
  onSubmit: (account: MacAccount) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  return (
    <form
      className="surface-raised flex w-72 flex-col gap-3 rounded-xl bg-main p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (username && password) onSubmit({ username, password, target: '' })
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-medium text-main">Sign in to this Mac</span>
        <span className={failed ? 'text-[12px] text-error' : 'text-[12px] text-secondary'}>
          {failed
            ? 'That account was not accepted. Try again.'
            : 'Use an account on the Mac to see its screen.'}
        </span>
      </div>
      <InputGroup className={FIELD}>
        <InputGroupInput
          aria-label="Mac account name"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Account name"
          className={CONTROL}
        />
      </InputGroup>
      <InputGroup className={FIELD}>
        <InputGroupInput
          aria-label="Mac password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className={CONTROL}
        />
      </InputGroup>
      <Button type="submit" size="sm" disabled={!username || !password}>
        Sign in
      </Button>
    </form>
  )
}
