// Pure language/script inference for the agent's per-turn response-language
// instruction. Zero imports so tests can load it without pulling in @/config
// (same split as stop-gate-judge-core.ts).
//
// Why script detection exists: "reply in the user's language" is not enough
// for Chinese. Under dense technical prose the model drifts from Traditional
// into Simplified characters (鏡像→镜像, 資料→资料) because most Chinese
// DevOps training text is Simplified. Naming the script explicitly in the
// instruction ("Traditional Chinese") is a far stronger conditioning signal
// than asking the model to infer it from the transcript at generation time.

export type ChineseScript = 'traditional' | 'simplified'

// Character pairs whose forms differ between scripts, picked from
// high-frequency function words plus the DevOps vocabulary that dominates
// these conversations — technical prose is exactly where drift happens, so
// those words pull the most weight. Parallel lists: SIMPLIFIED_ONLY[i] is the
// simplified form of TRADITIONAL_ONLY[i].
const TRADITIONAL_ONLY =
  '們會發這對說時東車經現話見記語讀邊達過還進遠違連問間門頭買賣樂書寫學習為無級紅組給絡絕統繼維網職聯辦華單價眾優傳傷體鏡資複據應變讓認識設試誤環節訊號務態狀負載庫隊線錯刪權證簽鑰關開圖斷續請幫個從點機電腦顯驗鍵'
const SIMPLIFIED_ONLY =
  '们会发这对说时东车经现话见记语读边达过还进远违连问间门头买卖乐书写学习为无级红组给络绝统继维网职联办华单价众优传伤体镜资复据应变让认识设试误环节讯号务态状负载库队线错删权证签钥关开图断续请帮个从点机电脑显验键'

const TRADITIONAL_SET = new Set(TRADITIONAL_ONLY)
const SIMPLIFIED_SET = new Set(SIMPLIFIED_ONLY)

/**
 * Which Chinese script the user writes. `texts` is newest-first; the newest
 * text with a decisive character majority wins, so a short ambiguous reply
 * ("ok", "好") cannot erase a whole conversation of Traditional.
 */
export function detectChineseScript(texts: readonly string[]): ChineseScript | null {
  for (const text of texts) {
    let traditional = 0
    let simplified = 0

    for (const ch of text) {
      if (TRADITIONAL_SET.has(ch)) traditional++
      else if (SIMPLIFIED_SET.has(ch)) simplified++
    }
    if (traditional > simplified) return 'traditional'
    if (simplified > traditional) return 'simplified'
  }

  return null
}

const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const KANA_RE = /[\u3040-\u30ff]/
const HANGUL_RE = /[\uac00-\ud7af]/

/**
 * Human-readable response-language instruction for the system prompt.
 * `userTexts` is every real user message text, newest-first.
 */
export function inferUserFacingLanguage(userTexts: readonly string[], locale: string): string {
  const latest = userTexts[0] ?? ''
  const normalizedLocale = locale.toLowerCase()

  // Kana before Han: Japanese text mixes kanji with kana, so a Han hit alone
  // must not classify it as Chinese.
  if (KANA_RE.test(latest)) return 'Japanese'
  if (HANGUL_RE.test(latest)) return 'Korean'
  if (HAN_RE.test(latest)) {
    // Han-only text is ambiguous: 「東京都内」 is valid kanji-only Japanese and
    // hanja still appears in Korean. Let a ja/ko locale break the tie.
    if (normalizedLocale.startsWith('ja')) return 'Japanese'
    if (normalizedLocale.startsWith('ko')) return 'Korean'

    return chineseLabel(detectChineseScript(userTexts))
  }

  if (normalizedLocale.startsWith('zh')) {
    return chineseLabel(detectChineseScript(userTexts))
  }
  if (normalizedLocale.startsWith('ja')) return 'Japanese'
  if (normalizedLocale.startsWith('ko')) return 'Korean'

  return 'the same language as the latest visible user message'
}

function chineseLabel(script: ChineseScript | null): string {
  if (script === 'traditional') {
    return 'Traditional Chinese — every Han character in its traditional form'
  }
  if (script === 'simplified') {
    return 'Simplified Chinese — every Han character in its simplified form'
  }

  return "Chinese, matching the user's script and wording style"
}
