export type SessionConfigOption = {
  id: string
  name: string
  kind: 'model' | 'effort' | 'fast'
  description?: string
  currentValue: string
  options: { value: string; name: string; description?: string }[]
}

export type SessionConfigState = {
  status: 'ready' | 'busy' | 'dormant' | 'unsupported' | 'offline'
  options: SessionConfigOption[]
  /** Why there are no options: the computer has not reported them, its agent is signed out, or none were found. */
  reason?: 'unreported' | 'signed-out' | 'undiscovered'
}

export type SessionConfigSelection = { configId: string; value: string }

/** Settings picked before a session exists, by option id; the runtime applies them when it starts one. */
export type SessionConfigPick = Partial<Record<'model' | 'effort' | 'fast', string>>
