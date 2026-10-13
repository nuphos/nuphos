export type FileTreeNode<F> = {
  name: string
  path: string
  file?: F
  children: FileTreeNode<F>[]
}

// Groups files by directory in their original order, folding single-child
// directory chains into one row the way GitHub's file tree does. A node is
// either a file or a directory, so a removed file `x` and an added `x/y`
// stay two separate rows.
export function buildFileTree<F extends { filename: string }>(files: F[]): FileTreeNode<F>[] {
  const root: FileTreeNode<F> = { name: '', path: '', children: [] }

  for (const file of files) {
    const parts = file.filename.split('/')
    let node = root

    parts.slice(0, -1).forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/')
      let dir = node.children.find((c) => !c.file && c.path === path)

      if (!dir) {
        dir = { name, path, children: [] }
        node.children.push(dir)
      }
      node = dir
    })
    node.children.push({ name: parts[parts.length - 1], path: file.filename, file, children: [] })
  }

  return root.children.map(collapse)
}

function collapse<F>(node: FileTreeNode<F>): FileTreeNode<F> {
  let current = node

  while (!current.file && current.children.length === 1 && !current.children[0].file) {
    const only = current.children[0]

    current = { ...only, name: `${current.name}/${only.name}` }
  }

  return { ...current, children: current.children.map(collapse) }
}

export function changedFileAnchor(filename: string): string {
  return `changed-file:${filename}`
}
