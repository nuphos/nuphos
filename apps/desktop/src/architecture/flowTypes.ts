// ReactFlow's node/edge type registries. Kept out of `nodes.tsx` / `edges.tsx`
// so those modules only export components and stay Fast Refresh friendly.

import { EditableEdge } from './edges'
import { ArchFlowNode, ArchGroupNode } from './nodes'

// NOTE: do not name the group entry 'group' — that collides with ReactFlow's
// built-in group type, which would layer its default node chrome under our box
// (two borders). Use a custom name so only our component renders.
export const nodeTypes = { arch: ArchFlowNode, archGroup: ArchGroupNode }

export const edgeTypes = { floating: EditableEdge }
