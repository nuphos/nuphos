import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep, win32 } from 'node:path'

/** Whether `target` lies inside `root`, component-wise and across Windows drives. */
export function isInside(root, target, paths = { relative, isAbsolute, sep }) {
  const rel = paths.relative(root, target)

  return !(paths.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${paths.sep}`))
}

export const windowsPaths = {
  relative: win32.relative,
  isAbsolute: win32.isAbsolute,
  sep: win32.sep,
}

/**
 * Every symlink in a staged bundle must resolve inside the bundle: a dangling
 * or escaping link breaks electron-builder and the signed app.
 */
export function findBrokenLinks(root) {
  const bundleRoot = realpathSync(root)
  const broken = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)

      if (entry.isSymbolicLink()) {
        let target

        try {
          target = realpathSync(path)
        } catch {
          broken.push(relative(root, path))
          continue
        }
        if (!isInside(bundleRoot, target)) broken.push(relative(root, path))
      } else if (entry.isDirectory() && !lstatSync(path).isSymbolicLink()) walk(path)
    }
  }

  walk(root)

  return broken
}
