export function required(name: string): string {
  const value = process.env[name]
  if (!value || value.startsWith('REPLACE_'))
    throw new Error(`Set ${name} before planning this project`)
  return value
}

export function optional(name: string): string | undefined {
  const value = process.env[name]
  return value && !value.startsWith('REPLACE_') ? value : undefined
}

export function domain(name: string): string {
  const value = required(name)
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(value))
    throw new Error(`${name} must be a hostname without scheme or path`)
  return value
}
