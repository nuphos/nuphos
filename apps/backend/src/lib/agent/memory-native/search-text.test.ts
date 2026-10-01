import { describe, expect, test } from 'bun:test'

import {
  buildCjkSearchText,
  expandSearchQuery,
  neutralizeTextOperators,
  segmentCjk,
} from './search-text'

describe('segmentCjk', () => {
  test('returns [] for pure English', () => {
    expect(segmentCjk('deploy failed, check cache origin requests')).toEqual([])
  })

  test('segments a Chinese clause into dictionary words', () => {
    const tokens = segmentCjk('部署失敗時先檢查快取')

    expect(tokens).toContain('部署')
    expect(tokens).toContain('失敗')
    expect(tokens).toContain('檢查')
    // No giant single token: the whole clause must not survive unsplit.
    expect(tokens).not.toContain('部署失敗時先檢查快取')
  })

  test('handles mixed English + Chinese, keeps only CJK tokens', () => {
    const tokens = segmentCjk('nuphos-backend 的 CPU 飆高問題')

    expect(tokens.join(' ')).not.toMatch(/nuphos|CPU/)
    expect(tokens).toContain('問題')
  })

  test('dedupes repeated words', () => {
    const tokens = segmentCjk('部署部署 部署')

    expect(tokens.filter((t) => t === '部署')).toHaveLength(1)
  })
})

describe('buildCjkSearchText', () => {
  test('empty for English-only parts', () => {
    expect(buildCjkSearchText(['deploy failed', null, undefined, 'cache'])).toBe('')
  })

  test('collects tokens across parts, space-joined', () => {
    const out = buildCjkSearchText(['部署失敗', '檢查快取'])

    for (const w of ['部署', '失敗', '檢查']) expect(out).toContain(w)
    expect(out).not.toMatch(/ {2}/)
  })
})

describe('expandSearchQuery', () => {
  test('English query passes through unchanged', () => {
    expect(expandSearchQuery('cache origin 429')).toBe('cache origin 429')
  })

  test('Chinese query gains segmented tokens alongside the original', () => {
    const out = expandSearchQuery('部署失敗')

    expect(out.startsWith('部署失敗')).toBe(true)
    expect(out).toContain(' 部署')
    expect(out).toContain('失敗')
  })

  test('simplified query gains the traditional counterpart (and back)', () => {
    expect(expandSearchQuery('数据库连接失败')).toContain('資料庫')
    expect(expandSearchQuery('数据库连接失败')).toContain('連線')
    expect(expandSearchQuery('資料庫連線失敗')).toContain('数据库')
  })

  test('zh query reaches en records via bilingual pairs', () => {
    const out = expandSearchQuery('台北那台虛擬機離線了')

    expect(out).toContain('taipei')
    expect(out).toContain('vm')
    expect(out).toContain('offline')
  })

  test('en query gains zh counterparts', () => {
    const out = expandSearchQuery('database backup failed')

    expect(out).toContain('資料庫')
    expect(out).toContain('備份')
  })

  test('simplified term bridges to english through its traditional form', () => {
    // 虚拟机 → 虛擬機 (variant) → vm/virtual machine (bilingual)
    const out = expandSearchQuery('虚拟机没起来')

    expect(out).toContain('虛擬機')
    expect(out).toContain('vm')
  })
})

describe('neutralizeTextOperators', () => {
  test('double quotes are stripped — one unmatched phrase must not zero the query', () => {
    // The prod shape: a pasted snippet turns the whole recall into a phrase
    // AND. The full cost-patrol trigger prompt scored 0 hits with its 20
    // quote characters and 10 without them.
    expect(neutralizeTextOperators('check "Authorization: Bearer $TOKEN" then report')).toBe(
      'check  Authorization: Bearer $TOKEN  then report',
    )
  })

  test('a token-leading hyphen is negation and is dropped', () => {
    expect(neutralizeTextOperators('gcloud routers update --router=uspace-nat -q')).toBe(
      'gcloud routers update router=uspace-nat q',
    )
  })

  test('hyphens inside words survive — they are identifiers, not operators', () => {
    expect(neutralizeTextOperators('server-* clean-free-cronjob ap-east-2')).toBe(
      'server-* clean-free-cronjob ap-east-2',
    )
  })

  test('expandSearchQuery neutralizes before expanding', () => {
    expect(expandSearchQuery('find "exact phrase" -excluded')).not.toContain('"')
    expect(expandSearchQuery('find "exact phrase" -excluded')).not.toContain(' -excluded')
  })
})
