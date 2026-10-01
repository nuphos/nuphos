import { describe, expect, test } from 'bun:test'

import { detectChineseScript, inferUserFacingLanguage } from './language'

describe('detectChineseScript', () => {
  test('traditional from a real user message', () => {
    expect(
      detectChineseScript(['先搬無狀態的後端服務就好,然後把 nginx ingress 和 cert manager 搭好']),
    ).toBe('traditional')
  })

  test('simplified from technical prose', () => {
    expect(detectChineseScript(['帮我看看这个服务的镜像和资料库配置'])).toBe('simplified')
  })

  test('ambiguous latest falls back to earlier decisive message', () => {
    expect(detectChineseScript(['ok', '好', '幫我在 nuphos 這個 gcp 帳號開一個 gke 集群'])).toBe(
      'traditional',
    )
  })

  test('newest decisive message wins over older opposite script', () => {
    // texts are newest-first: index 0 (simplified) is the latest message
    expect(detectChineseScript(['帮我删除这个集群', '幫我開一個集群'])).toBe('simplified')
  })

  test('no distinctive characters anywhere', () => {
    expect(detectChineseScript(['ok', 'run it', ''])).toBeNull()
    expect(detectChineseScript([])).toBeNull()
  })
})

describe('inferUserFacingLanguage', () => {
  test('names the script for a Traditional Chinese user', () => {
    const result = inferUserFacingLanguage(
      ['先縮成一個 node 就好,省點錢', '幫我開一個 gke 集群'],
      'en-US',
    )

    expect(result).toContain('Traditional Chinese')
    expect(result).toContain('traditional form')
  })

  test('names the script for a Simplified Chinese user', () => {
    expect(inferUserFacingLanguage(['帮我查一下这个服务的日志'], 'en-US')).toContain(
      'Simplified Chinese',
    )
  })

  test('falls back to generic Chinese when the script is indeterminate', () => {
    expect(inferUserFacingLanguage(['你好'], 'en-US')).toBe(
      "Chinese, matching the user's script and wording style",
    )
  })

  test('kana beats Han characters for Japanese text', () => {
    expect(inferUserFacingLanguage(['日本語で説明してください'], 'en-US')).toBe('Japanese')
  })

  test('Han-only text defers to a ja/ko locale', () => {
    expect(inferUserFacingLanguage(['東京都内'], 'ja-JP')).toBe('Japanese')
    expect(inferUserFacingLanguage(['大韓民國'], 'ko-KR')).toBe('Korean')
  })

  test('Han-only text with a non-CJK locale stays Chinese', () => {
    expect(inferUserFacingLanguage(['幫我開一個集群'], 'en-US')).toContain('Traditional Chinese')
  })

  test('Korean via Hangul', () => {
    expect(inferUserFacingLanguage(['서비스 로그 좀 봐줘'], 'en-US')).toBe('Korean')
  })

  test('zh locale with non-Chinese latest text still detects script from history', () => {
    expect(inferUserFacingLanguage(['retry', '幫我建立集群'], 'zh-TW')).toContain(
      'Traditional Chinese',
    )
  })

  test('plain English with en locale', () => {
    expect(inferUserFacingLanguage(['list my clusters'], 'en-US')).toBe(
      'the same language as the latest visible user message',
    )
  })
})
