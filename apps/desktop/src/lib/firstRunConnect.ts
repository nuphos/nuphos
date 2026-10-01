// Vocabulary and scope for the first-run connect guide.
//
// Two things live here because both the guide and the bind wizard need them and
// they must not drift:
//
//   1. Every cloud calls the same object something different — an AWS IAM role,
//      a GCP service account, an Azure app registration. The guide explains a
//      mechanism, so it has to use the name the user will actually see in their
//      own console, or the instructions stop matching the screen.
//
//   2. The scope we ask for first: cost/billing read-only, and nothing else.
//      That choice does two jobs at once. It is the one grant that is easy to
//      give a stranger, and it answers the question teams most want answered on
//      day one — where the money is going. And because *we* picked the boundary,
//      we know exactly where it ends: the first question that reaches past it
//      hits a designed moment rather than an accident.

export const FIRST_RUN_PROVIDERS = ['aws', 'gcp', 'azure'] as const

export type FirstRunProvider = (typeof FIRST_RUN_PROVIDERS)[number]

export function isFirstRunProvider(provider: string): provider is FirstRunProvider {
  return (FIRST_RUN_PROVIDERS as readonly string[]).includes(provider)
}

export type FirstRunVocabulary = {
  /** How the provider is named in prose. */
  label: string
  /** Whether this provider's first-run journey is ready for users. */
  available: boolean
  /** What the operational identity is called in this cloud's console. */
  noun: string
  /** What a unit of permission is called here — attached to the noun above. */
  grantNoun: string
  /** The cost/billing read-only grant we ask for first, verbatim. */
  scopeGrant: string
  /** Its human-readable name, when the identifier above isn't one. */
  scopeLabel: string
  /** Where in the console the grant gets attached. */
  scopeWhere: string
  /** The scope caveat, when this cloud has one worth stating up front. */
  scopeNote?: string
  /** What the first question actually asks for, in one clause. Provider-specific
   *  because the grants differ in what they can answer: AWS and Azure expose a
   *  cost-breakdown API, Google Cloud does not — its first half reports the
   *  billing account's shape instead. Promising a breakdown we cannot deliver
   *  would make the first answer read as a failure. */
  questionAsks: string
  /** What that answer is called afterwards, as a noun phrase. */
  answerNoun: string
  /** The promise the scenario screen opens on. Provider-specific for the same
   *  reason `questionAsks` is: it is shown after the cloud is picked, so it can
   *  finally say what this particular cloud's grant will actually do. */
  introPitch: string
  /** The last line of that screen's plan — what the user gets at the end. */
  introPayoff: string
}

const VOCABULARY: Record<FirstRunProvider, FirstRunVocabulary> = {
  aws: {
    label: 'AWS',
    available: true,
    noun: 'IAM role',
    grantNoun: 'policy',
    scopeGrant: 'AWSBillingReadOnlyAccess',
    scopeLabel: 'Billing read-only',
    scopeWhere: 'the Add permissions page',
    questionAsks:
      "where last month's money went, what grew, what looks like waste, and which resources it all belongs to",
    answerNoun: 'your savings list',
    introPitch: 'Grant one billing read-only role and Nuphos digs through your bill for savings.',
    introPayoff: 'Nuphos reads the bill and shows you what to cut.',
  },
  gcp: {
    label: 'Google Cloud',
    available: true,
    noun: 'service account',
    grantNoun: 'role',
    scopeGrant: 'roles/billing.viewer',
    scopeLabel: 'Billing Account Viewer',
    scopeWhere: 'the billing account',
    scopeNote:
      'The billing account is the lowest resource this role can be granted on — the project role picker does not list it at all.',
    questionAsks:
      'which billing account pays for this, which projects it covers, what budgets are set on it, and what is actually running inside those projects',
    answerNoun: "your billing account's shape",
    introPitch:
      'Grant one billing read-only role and Nuphos starts at your billing account, then works out to what you are actually running.',
    introPayoff:
      'Nuphos reads your billing account, then looks behind it at what is running to find the waste.',
  },
  azure: {
    label: 'Azure',
    available: true,
    noun: 'app registration',
    grantNoun: 'role assignment',
    scopeGrant: 'Cost Management Reader',
    scopeLabel: 'Cost Management Reader',
    scopeWhere: 'the subscription',
    questionAsks:
      "where last month's money went, what grew, what looks like waste, and which resources it all belongs to",
    answerNoun: 'your savings list',
    introPitch: 'Grant one billing read-only role and Nuphos digs through your bill for savings.',
    introPayoff: 'Nuphos reads the bill and shows you what to cut.',
  },
}

export function firstRunVocabulary(provider: FirstRunProvider): FirstRunVocabulary {
  return VOCABULARY[provider]
}

/** The languages the guide can hand out prompts in. A short list of common
 *  ones rather than a locale matrix: these are questions the user pastes and
 *  then converses around, so what matters is that the conversation starts in
 *  the language they'll continue in. Labels are each language's own name —
 *  the one line everyone can read is their own. */
export const FIRST_RUN_PROMPT_LANGS = [
  { id: 'en', label: 'English' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'ja', label: '日本語' },
  { id: 'es', label: 'Español' },
  { id: 'id', label: 'Bahasa Indonesia' },
] as const

export type FirstRunPromptLang = (typeof FIRST_RUN_PROMPT_LANGS)[number]['id']

export function isFirstRunPromptLang(lang: string): lang is FirstRunPromptLang {
  return FIRST_RUN_PROMPT_LANGS.some((l) => l.id === lang)
}

const LANDING_PROMPTS: Record<FirstRunPromptLang, (label: string) => string> = {
  en: (label) =>
    [
      `My ${label} account is now connected to Nuphos with cost read-only access and nothing else.`,
      'Show me where the money went last month: the biggest line items, anything that grew sharply against the month before, and anything that looks like waste.',
      'Then match that against what is actually running right now — which resources those charges belong to, and which of them look idle or oversized for what they do.',
    ].join(' '),
  'zh-TW': (label) =>
    `我的 ${label} 帳號剛連上 Nuphos，目前只有帳務唯讀權限。幫我看看上個月的錢花去哪了：最大的支出項目、比前一個月明顯暴增的部分，以及看起來像浪費的東西。接著跟現在實際在跑的東西對照一下：這些費用分別對應哪些資源，其中哪些看起來閒置或規格過大。`,
  'zh-CN': (label) =>
    `我的 ${label} 账号刚连上 Nuphos，目前只有账务只读权限。帮我看看上个月的钱花到哪儿了：最大的支出项目、比上个月明显激增的部分，以及看起来像浪费的东西。接着跟现在实际在跑的东西对照一下：这些费用分别对应哪些资源，其中哪些看起来闲置或规格过大。`,
  ja: (label) =>
    `私の ${label} アカウントは Nuphos に接続されたばかりで、権限はコストの読み取り専用だけです。先月のお金の行き先を見せてください：最も大きな費目、前月から急増したもの、無駄に見えるもの。そのうえで、今実際に動いているものと照らし合わせてください：その費用がどのリソースに対応するのか、そのうちどれが遊休状態やサイズ過剰に見えるのか。`,
  es: (label) =>
    `Mi cuenta de ${label} acaba de conectarse a Nuphos, con acceso de solo lectura a costos y nada más. Muéstrame a dónde se fue el dinero el mes pasado: las partidas más grandes, lo que creció bruscamente respecto al mes anterior y lo que parezca desperdicio. Después contrástalo con lo que está corriendo ahora mismo: a qué recursos corresponden esos cargos y cuáles parecen ociosos o sobredimensionados para lo que hacen.`,
  id: (label) =>
    `Akun ${label} saya baru saja terhubung ke Nuphos, hanya dengan akses baca biaya dan tidak ada yang lain. Tunjukkan ke mana uang saya pergi bulan lalu: pos pengeluaran terbesar, apa pun yang naik tajam dibanding bulan sebelumnya, dan apa pun yang tampak seperti pemborosan. Lalu bandingkan dengan apa yang sebenarnya berjalan sekarang: biaya itu berasal dari sumber daya mana, dan mana yang tampak menganggur atau berukuran berlebihan.`,
}

const GCP_LANDING_PROMPTS: Record<FirstRunPromptLang, (label: string) => string> = {
  en: (label) =>
    [
      `My ${label} account is now connected to Nuphos with billing read-only access and nothing else.`,
      'Start with what that covers: which billing account this is, which projects it pays for, and what budgets and alert thresholds are set on it.',
      'Then go past it — match those projects against what is actually running inside them right now, which resources they hold, and which of those look idle or oversized for what they do.',
    ].join(' '),
  'zh-TW': (label) =>
    `我的 ${label} 帳號剛連上 Nuphos，目前只有帳務唯讀權限。先從這個權限看得到的開始：這是哪一個付款帳戶、它替哪些專案付錢、上面設了哪些預算和警示門檻。接著往外看，把這些專案跟現在實際在裡面跑的東西對照一下：它們各自有哪些資源，其中哪些看起來閒置或規格過大。`,
  'zh-CN': (label) =>
    `我的 ${label} 账号刚连上 Nuphos，目前只有账务只读权限。先从这个权限看得到的开始：这是哪一个付款账户、它替哪些项目付钱、上面设了哪些预算和告警阈值。接着往外看，把这些项目跟现在实际在里面跑的东西对照一下：它们各自有哪些资源，其中哪些看起来闲置或规格过大。`,
  ja: (label) =>
    `私の ${label} アカウントは Nuphos に接続されたばかりで、権限は請求の読み取り専用だけです。まずはその権限で見えるものから：これはどの請求先アカウントで、どのプロジェクトの支払いを担っていて、どんな予算とアラートのしきい値が設定されているか。そのうえで、その先へ——それらのプロジェクトで今実際に動いているものと照らし合わせてください：どんなリソースを抱えていて、そのうちどれが遊休状態やサイズ過剰に見えるのか。`,
  es: (label) =>
    `Mi cuenta de ${label} acaba de conectarse a Nuphos, con acceso de solo lectura a la facturación y nada más. Empieza por lo que eso cubre: qué cuenta de facturación es esta, qué proyectos paga, y qué presupuestos y umbrales de alerta tiene configurados. Después ve más allá: contrasta esos proyectos con lo que está corriendo dentro de ellos ahora mismo, qué recursos contienen y cuáles parecen ociosos o sobredimensionados para lo que hacen.`,
  id: (label) =>
    `Akun ${label} saya baru saja terhubung ke Nuphos, hanya dengan akses baca penagihan dan tidak ada yang lain. Mulai dari apa yang tercakup di situ: ini akun penagihan yang mana, proyek apa saja yang dibayarinya, dan anggaran serta ambang peringatan apa yang disetel padanya. Lalu lanjut lebih jauh: bandingkan proyek-proyek itu dengan apa yang sebenarnya berjalan di dalamnya sekarang, sumber daya apa yang ada di sana, dan mana yang tampak menganggur atau berukuran berlebihan.`,
}

export function firstRunLandingPrompt(
  provider: FirstRunProvider,
  lang: FirstRunPromptLang = 'en',
): string {
  const prompts = provider === 'gcp' ? GCP_LANDING_PROMPTS : LANDING_PROMPTS

  return prompts[lang](VOCABULARY[provider].label)
}

/** The agent panel's conversation breadcrumbs, as a window event: `asked`
 *  fires when the user sends a message, `answered` when a turn's stream ends.
 *  The first-run panel listens so its journey strip can advance on the real
 *  moves — the panel and the chat are separate component trees, and this
 *  keeps them that way. Fired unconditionally; only the panel's active stage
 *  decides whether a breadcrumb means anything. */
export const FIRST_RUN_CONVO_EVENT = 'nuphos:first-run-conversation'

export type FirstRunConvoPhase = 'asked' | 'answered'

/** Dev-only console control: the `onboarding.firstRun.stage(...)` hook jumps
 *  the first-run panel to any stage through this window event, so every screen
 *  can be reached without redoing a real cloud bind. */
export const FIRST_RUN_DEV_STAGE_EVENT = 'nuphos:first-run-dev-stage'

export type FirstRunDevStage = {
  kind: 'intro' | 'pick' | 'setup' | 'connected' | 'first-question' | 'finished'
  provider?: string
  /** Setup step to land on, clamped to the provider's step count. For
   *  `first-question` it previews the conversation phases instead: 1 asked,
   *  2 answered (which is also the wall). */
  step?: number
}
