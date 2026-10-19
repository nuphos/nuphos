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
  username: withUsername,
  onSubmit,
}: {
  failed: boolean
  /** False when the Mac takes a VNC password alone. */
  username: boolean
  onSubmit: (account: MacAccount) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const ready = Boolean(password) && (!withUsername || Boolean(username))
  let hint = 'Use an account on the Mac to see its screen.'

  if (failed) hint = 'That account was not accepted. Try again.'
  else if (!withUsername) hint = 'Enter the Mac’s Screen Sharing password.'

  return (
    <form
      className="surface-raised flex w-72 flex-col gap-3 rounded-xl bg-main p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSubmit({ username: withUsername ? username : '', password, target: '' })
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-medium text-main">Sign in to this Mac</span>
        <span className={failed ? 'text-[12px] text-error' : 'text-[12px] text-secondary'}>
          {hint}
        </span>
      </div>
      {withUsername && (
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
      )}
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
      <Button type="submit" size="sm" disabled={!ready}>
        Sign in
      </Button>
    </form>
  )
}
