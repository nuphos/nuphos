import { randomBytes } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const envPath = resolve(import.meta.dir, '..', '.env.local')
const keyName = 'DATABASE_CREDENTIAL_ENCRYPTION_KEY'
const keyIdName = 'DATABASE_CREDENTIAL_ENCRYPTION_KEY_ID'
const keyId = 'local-dev-v1'

let contents = ''

try {
  contents = await readFile(envPath, 'utf8')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const hasKey = new RegExp(`^${keyName}=.+$`, 'm').test(contents)
const hasKeyId = new RegExp(`^${keyIdName}=.+$`, 'm').test(contents)

if (!hasKey) {
  const prefix = contents.length > 0 && !contents.endsWith('\n') ? '\n' : ''

  contents += `${prefix}${keyName}=${randomBytes(32).toString('base64')}\n`
}

if (!hasKeyId) {
  const prefix = contents.length > 0 && !contents.endsWith('\n') ? '\n' : ''

  contents += `${prefix}${keyIdName}=${keyId}\n`
}

await writeFile(envPath, contents, { mode: 0o600 })
await chmod(envPath, 0o600)

console.log(`Local database credential key is configured in ${envPath} (${keyIdName}=${keyId}).`)
