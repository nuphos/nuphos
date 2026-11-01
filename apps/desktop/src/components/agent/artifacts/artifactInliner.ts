// Inlines what a page or SVG loads from the web, so a downloaded artifact is
// one file that needs no network. Used by artifactExport.ts.
import { t } from '../../../i18n/index.ts'

import {
  REMOTE,
  absolute,
  attribute,
  base64,
  decodeEntities,
  escapeAttribute,
  mimeOf,
  parseAttributes,
  parseImport,
  renderAttributes,
  replaceAsync,
  unquote,
} from './artifactMarkup.ts'

import type { FetchAsset, FetchedAsset } from './artifactExport.ts'

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const LINK = /<link\b([^>]*)>/gi
const MEDIA = /<(img|source|video|audio|image|input)\b([^>]*)>/gi
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi
const CSS_IMPORT = /@import([^;]*);/gi
const CSS_URL = /url\(([^)]*)\)/gi
const REMOTE_IMPORT = /\b(?:from|import)[\s(]*["'](?:https?:)?\/\//

export class Inliner {
  readonly missing = new Set<string>()
  private readonly cache = new Map<string, Promise<FetchedAsset | null>>()

  private readonly fetcher: FetchAsset

  constructor(fetcher: FetchAsset) {
    this.fetcher = fetcher
  }

  private get(url: string): Promise<FetchedAsset | null> {
    let pending = this.cache.get(url)

    if (!pending) {
      pending = this.fetcher(url).then((asset) => {
        if (!asset) this.missing.add(url)

        return asset
      })
      this.cache.set(url, pending)
    }

    return pending
  }

  private async text(url: string): Promise<string | null> {
    const asset = await this.get(url)

    return asset ? new TextDecoder().decode(asset.bytes) : null
  }

  private async dataUrl(url: string): Promise<string | null> {
    const asset = await this.get(url)

    return asset ? `data:${mimeOf(asset, url)};base64,${base64(asset.bytes)}` : null
  }

  async markup(html: string): Promise<string> {
    let out = await replaceAsync(html, SCRIPT, (match) => this.script(match))

    out = await replaceAsync(out, LINK, (match) => this.link(match))
    out = await replaceAsync(out, MEDIA, (match) => this.media(match))
    out = await replaceAsync(out, STYLE_BLOCK, async ([, open = '', css = '', close = '']) => {
      return `${open}${await this.css(css)}${close}`
    })

    return await replaceAsync(out, STYLE_ATTRIBUTE, async ([, lead = '', quoted = '']) => {
      const quote = quoted[0] ?? '"'
      const css = await this.css(decodeEntities(quoted.slice(1, -1)))

      return `${lead}${quote}${css.replace(/&/g, '&amp;').replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`
    })
  }

  private async script(match: RegExpExecArray): Promise<string> {
    const [whole, rawAttributes = '', body = ''] = match
    const attributes = parseAttributes(rawAttributes)
    const url = absolute(attribute(attributes, 'src') ?? '')
    const module = attribute(attributes, 'type')?.toLowerCase() === 'module'

    if (!url) {
      if (module && REMOTE_IMPORT.test(body))
        this.missing.add(t('a module script that imports from the web'))

      return whole
    }
    const code = await this.text(url)

    if (code === null) return whole
    if (module && REMOTE_IMPORT.test(code))
      this.missing.add(t('{url} (imports more modules from the web)', { url }))

    return `<script${renderAttributes(attributes, ['src', 'integrity', 'crossorigin', 'async', 'defer'])}>${code.replace(/<\/script/gi, '<\\/script')}</script>`
  }

  private async link(match: RegExpExecArray): Promise<string> {
    const [whole, rawAttributes = ''] = match
    const attributes = parseAttributes(rawAttributes)
    const rel = (attribute(attributes, 'rel') ?? '').toLowerCase().split(/\s+/)
    const url = absolute(attribute(attributes, 'href') ?? '')

    if (!url) return whole
    if (rel.includes('stylesheet')) {
      const css = await this.text(url)

      if (css === null) return whole
      const media = attribute(attributes, 'media')
      const mediaAttribute = media ? ` media="${escapeAttribute(media)}"` : ''
      const inlined = (await this.css(css, url)).replace(/<\/style/gi, '<\\/style')

      return `<style${mediaAttribute}>${inlined}</style>`
    }
    if (rel.includes('icon')) {
      const data = await this.dataUrl(url)

      return data
        ? `<link${renderAttributes(attributes, ['href', 'integrity', 'crossorigin'])} href="${data}">`
        : whole
    }

    // preconnect, preload and the like only point at the network.
    return ''
  }

  private async media(match: RegExpExecArray): Promise<string> {
    const [whole, tag = '', rawAttributes = ''] = match
    const selfClose = rawAttributes.trimEnd().endsWith('/') ? '/' : ''
    const attributes = parseAttributes(rawAttributes)
    let changed = false

    for (const entry of attributes) {
      if (!['src', 'href', 'xlink:href', 'poster'].includes(entry.name) || !entry.value) continue
      const url = absolute(entry.value)

      if (!url) continue
      const data = await this.dataUrl(url)

      if (data) {
        entry.value = data
        changed = true
      }
    }
    const srcset = attributes.find((entry) => entry.name === 'srcset')

    // A srcset can only add remote candidates; src alone stays.
    if (srcset?.value && REMOTE.test(srcset.value.trim())) {
      attributes.splice(attributes.indexOf(srcset), 1)
      changed = true
    }

    return changed ? `<${tag}${renderAttributes(attributes)}${selfClose}>` : whole
  }

  private async css(css: string, base?: string, depth = 0): Promise<string> {
    const imported = await replaceAsync(css, CSS_IMPORT, async (match) => {
      const [whole, rule = ''] = match
      const { ref, media } = parseImport(rule)
      const url = absolute(ref, base)

      if (!url || depth > 2) return whole
      const text = await this.text(url)

      if (text === null) return whole
      const inner = await this.css(text, url, depth + 1)

      return media ? `@media ${media}{${inner}}` : inner
    })

    return await replaceAsync(imported, CSS_URL, async (match) => {
      const [whole, inside = ''] = match
      const ref = unquote(inside)

      if (ref.startsWith('data:') || ref.startsWith('#')) return whole
      const url = absolute(ref, base)

      if (!url) return whole
      const data = await this.dataUrl(url)

      return data ? `url("${data}")` : whole
    })
  }
}
