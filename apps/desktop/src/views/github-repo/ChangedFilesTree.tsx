import { Folder } from 'lucide-react'
import { useMemo } from 'react'

import { FileStatusIcon } from './FileStatusIcon'
import { buildFileTree, changedFileAnchor } from './fileTree'

import type { FileTreeNode } from './fileTree'
import type { GithubPRFile } from '../../types'

function TreeRows({ nodes, depth }: { nodes: FileTreeNode<GithubPRFile>[]; depth: number }) {
  return nodes.map((node) => {
    const indent = { paddingLeft: `${String(8 + depth * 12)}px` }
    const { file } = node

    if (!file) {
      return (
        <div key={node.path}>
          <div
            className="flex h-7 items-center gap-1.5 pr-2 text-[12px] text-secondary"
            style={indent}
            title={node.path}
          >
            <Folder className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={1.8} />
            <span className="truncate">{node.name}</span>
          </div>
          <TreeRows nodes={node.children} depth={depth + 1} />
        </div>
      )
    }

    return (
      <button
        key={node.path}
        type="button"
        onClick={() =>
          document
            .getElementById(changedFileAnchor(file.filename))
            ?.scrollIntoView({ block: 'start' })
        }
        className="flex h-7 w-full items-center gap-1.5 rounded pr-2 text-left text-[12px] text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main"
        style={indent}
        title={file.filename}
      >
        <FileStatusIcon status={file.status} />
        <span className="truncate">{node.name}</span>
      </button>
    )
  })
}

export function ChangedFilesTree({ files }: { files: GithubPRFile[] }) {
  const tree = useMemo(() => buildFileTree(files), [files])

  return (
    <nav className="py-2">
      <TreeRows nodes={tree} depth={0} />
    </nav>
  )
}
