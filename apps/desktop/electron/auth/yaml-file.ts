import fs from 'node:fs/promises'
import path from 'node:path'

import yaml from 'js-yaml'

/** The file's content, `{}` when empty, `null` when missing or unreadable. */
export async function readYaml<T extends object>(at: string): Promise<T | null> {
  try {
    return (yaml.load(await fs.readFile(at, 'utf-8')) as T | null) ?? ({} as T)
  } catch {
    return null
  }
}

/** Writes the file readable only by this user. */
export async function writeYaml(at: string, value: object): Promise<void> {
  await fs.mkdir(path.dirname(at), { recursive: true })
  // skipInvalid drops the fields left `undefined`.
  await fs.writeFile(at, yaml.dump(value, { skipInvalid: true }), {
    encoding: 'utf-8',
    mode: 0o600,
  })
  // `mode` applies only when the file is created.
  await fs.chmod(at, 0o600)
}
