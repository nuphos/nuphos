import type { AwsS3Bucket } from '../../types'

export function s3ConsoleBucketUrl(bucket: AwsS3Bucket, prefix = ''): string {
  const region = bucket.region || 'us-east-1'
  const base = `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(bucket.name)}?region=${encodeURIComponent(region)}`

  return prefix ? `${base}&prefix=${encodeURIComponent(prefix)}` : base
}

export function s3ConsoleObjectUrl(bucket: AwsS3Bucket, key: string): string {
  const region = bucket.region || 'us-east-1'

  return `https://s3.console.aws.amazon.com/s3/object/${encodeURIComponent(bucket.name)}?region=${encodeURIComponent(region)}&prefix=${encodeURIComponent(key)}`
}

export function s3Uri(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|svg|webp|ico|bmp|avif)$/i
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'csv',
  'tsv',
  'log',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'cjs',
  'mjs',
  'py',
  'go',
  'rs',
  'sh',
  'bash',
  'zsh',
  'fish',
  'conf',
  'env',
  'toml',
  'ini',
  'sql',
  'properties',
  'gradle',
  'dockerfile',
  'gitignore',
  'gitattributes',
  'nvmrc',
  'babelrc',
  'prettierrc',
  'editorconfig',
])
const NAMED_TEXT_RE =
  /(?:^|\/)(readme|license|dockerfile|makefile|procfile|gemfile|rakefile)(\.[^/]+)?$/i

function hasTextExtension(key: string): boolean {
  const name = key.slice(key.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')

  return dot > -1 && TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

export function isImageObject(key: string, contentType: string | null = null): boolean {
  if (IMAGE_EXT_RE.test(key)) return true
  if (contentType && contentType.startsWith('image/')) return true

  return false
}

export function isTextObject(key: string, contentType: string | null = null): boolean {
  if (hasTextExtension(key)) return true
  if (NAMED_TEXT_RE.test(key)) return true
  if (contentType) {
    if (contentType.startsWith('text/')) return true
    if (/(json|xml|yaml|javascript|typescript|x-sh|x-shellscript)/.test(contentType)) return true
  }

  return false
}
