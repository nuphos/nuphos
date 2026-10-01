// Renderer-side pointer to the architecture diagram the user currently has open.
//
// The Canvas sets this while it's mounted; the AgentPanel reads it when starting
// a chat so the request carries the open diagram id (sent as X-Atlas-Diagram-Id),
// which is what unlocks the backend's arch_* editing tools. Using a tiny module
// singleton avoids threading diagram state through App.tsx's tab system + the
// AgentPanel prop chain just to reach the agent request.

let activeDiagramId: string | null = null

export function setActiveDiagramId(id: string | null): void {
  activeDiagramId = id
}

export function getActiveDiagramId(): string | null {
  return activeDiagramId
}
