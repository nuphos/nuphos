// ReactFlow's node/edge registries for the design canvas. Kept apart from the
// component modules so those stay Fast Refresh friendly.
import { FlowLinkEdge } from './edges'
import { FrameNode } from './FrameNode'
import { SectionNode } from './SectionNode'
import { InkNode, ShapeNode } from './ShapeNodes'
import { NoteNode, TextNode } from './TextNodes'

export const nodeTypes = {
  designFrame: FrameNode,
  designSection: SectionNode,
  designText: TextNode,
  designNote: NoteNode,
  designInk: InkNode,
  designShape: ShapeNode,
}

export const edgeTypes = { designLink: FlowLinkEdge }

export const NODE_TYPE_OF = {
  frame: 'designFrame',
  section: 'designSection',
  text: 'designText',
  note: 'designNote',
  ink: 'designInk',
  shape: 'designShape',
} as const
