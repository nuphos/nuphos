export function required(name: string): string {
  const value = process.env[name]
  if (!value || value.startsWith('REPLACE_'))
    throw new Error(`Set ${name} before planning this project`)
  return value
}

export function domain(name: string): string {
  const value = required(name)
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(value))
    throw new Error(`${name} must be a hostname without scheme or path`)
  return value
}
