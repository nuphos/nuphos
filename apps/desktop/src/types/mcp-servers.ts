export type TeamMcpServer = {
  id: string
  name: string
  url: string
  headers: string[]
  createdAt: string
  updatedAt: string
}

export type McpServerHeaderInput = {
  name: string
  /** Omit to keep the stored encrypted value when editing. */
  value?: string
}

export type McpServerInput = {
  name: string
  url: string
  headers: McpServerHeaderInput[]
}
