// The drill-down a team page's path segment names; the name is a placeholder
// until the page loads the real one.
import type { NavigationSnapshot } from './types.ts'

export function architectureDetailOf(diagramId: string | undefined): Partial<NavigationSnapshot> {
  return diagramId ? { architectureDetail: { diagramId, diagramName: 'Diagram' } } : {}
}

export function designDetailOf(designId: string | undefined): Partial<NavigationSnapshot> {
  return designId ? { designDetail: { designId, designName: 'Design' } } : {}
}
