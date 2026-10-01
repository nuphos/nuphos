export const AGENT_PHASE_LABELS = {
  'request-accepted': 'Request accepted by backend…',
  'saving-turn': 'Saving your message…',
  'building-context': 'Reading page context…',
  'loading-credentials': 'Loading selected credentials…',
  'preparing-tools': 'Preparing tools and sandbox…',
  'building-prompt': 'Building agent instructions…',
  'recalling-memory': 'Recalling memories…',
  'loading-compaction': 'Loading conversation summary…',
  'preparing-model': 'Preparing model request…',
  'connecting-model': 'Connecting to model…',
  thinking: 'Thinking…',
  stopping: 'Stopping…',
} as const

export type AgentPhase = keyof typeof AGENT_PHASE_LABELS
