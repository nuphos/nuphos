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
}

export type SessionConfigSelection = { configId: string; value: string }
