export type FileTreeNode<F> = {
  name: string
  path: string
  file?: F
  children: FileTreeNode<F>[]
}

// Groups files by directory in their original order, folding single-child
// directory chains into one row the way GitHub's file tree does.
export function buildFileTree<F extends { filename: string }>(files: F[]): FileTreeNode<F>[] {
  const root: FileTreeNode<F> = { name: '', path: '', children: [] }

  for (const file of files) {
    const parts = file.filename.split('/')
    let node = root

    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/')
      let child = node.children.find((c) => c.path === path)

      if (!child) {
        child = { name, path, children: [] }
        node.children.push(child)
      }
      if (index === parts.length - 1) child.file = file
      node = child
    })
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
