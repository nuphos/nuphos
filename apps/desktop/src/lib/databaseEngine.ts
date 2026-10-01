export function databaseEngineLabel(engine?: string): string {
  if (engine === 'mongodb') return 'MongoDB'
  if (engine === 'postgresql') return 'PostgreSQL'
  if (engine === 'mysql') return 'MySQL'
  if (engine === 'cloudflare-d1') return 'Cloudflare D1'

  return 'Database'
}
