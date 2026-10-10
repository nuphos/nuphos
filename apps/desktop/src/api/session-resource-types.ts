export type SessionResource = {
  id: string
  provider: 'github' | 'linear'
  title: string
  url: string
  state: string
  repository?: string
  number?: number
  linkedAt: string
}

export type SessionResourcesResponse = { resources: SessionResource[]; canManage: boolean }
