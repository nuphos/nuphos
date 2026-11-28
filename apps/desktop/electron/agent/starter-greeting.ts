import { LOCAL_RUNTIME_NAMES, LOCAL_WORDS } from './starter-greeting-local.ts'

type Words = {
  join: string
  introduction: string
  trial: string
  none: string
  linear: string
  picked: (names: string) => string
}

/**
 * The starter Bot's first message: iOS's wording (NubieOnboardingImport.swift),
 * except that on Desktop the trial line also offers the computer the user is on.
 */
const WORDS: Record<string, Words> = {
  en: {
    join: ', ',
    introduction:
      'Welcome! This is your first Box, a cloud computer from Nuphos. It comes with free AI trial credit, so you can give me a small task and see what a Bot can do.',
    trial:
      'This Box is yours to try for now. When you want to keep going, I can help you connect your own AI subscription, or use this computer you’re on right now.',
    none: 'What would you like to try first?',
    linear:
      'You picked Linear. Click Connect Linear below to try using your trial credit to see what’s on your to-do list.',
    picked: (names) =>
      `You picked ${names}. Pick a tool below to connect it and try a small task with your trial credit.`,
  },
  'zh-TW': {
    join: '、',
    introduction:
      '歡迎！這是 Nuphos 送你的第一台 Box，也就是一台雲端電腦。它附有免費 AI 試用額度，讓你先交給我一件小事，看看 Bot 能怎麼幫你。',
    trial:
      '這台 Box 是暫時給你試用的。等你想繼續使用，我可以帶你連接自己的 AI 訂閱，或直接使用你現在這台電腦。',
    none: '想先試哪件小事？',
    linear: '你剛才選了 Linear。點下方的「連接 Linear」，我就能用試用額度幫你看看手上有哪些待辦。',
    picked: (names) => `你剛才選了${names}。選下方想連接的工具，就能用試用額度跑一個小任務。`,
  },
  'zh-CN': {
    join: '、',
    introduction:
      '欢迎！这是 Nuphos 送你的第一台 Box，也就是一台云端电脑。它附有免费 AI 试用额度，让你先交给我一件小事，看看 Bot 能怎么帮你。',
    trial:
      '这台 Box 是暂时给你试用的。等你想继续使用，我可以帮你连接自己的 AI 订阅，或直接使用你现在这台电脑。',
    none: '想先试哪件小事？',
    linear: '你刚才选了 Linear。点下方的“连接 Linear”，我就能用试用额度帮你看看手上有哪些待办。',
    picked: (names) => `你刚才选了${names}。选下方想连接的工具，就能用试用额度跑一个小任务。`,
  },
  ja: {
    join: '、',
    introduction:
      'ようこそ！これは Nuphos からあなたへの最初の Box、クラウド上のコンピュータです。無料の AI 試用クレジットが付いているので、まずは小さな作業を任せて、Bot に何ができるか試してみてください。',
    trial:
      'この Box はお試し用です。続けて使いたくなったら、ご自身の AI サブスクリプションをつなぐか、いま使っているこのコンピュータを使えるようにお手伝いします。',
    none: 'まず何を試してみますか？',
    linear:
      'Linear を選びましたね。下の「Linear を接続」をクリックすると、試用クレジットであなたの ToDo を確認できます。',
    picked: (names) =>
      `${names} を選びましたね。下から接続したいツールを選ぶと、試用クレジットで小さな作業を試せます。`,
  },
  ko: {
    join: ', ',
    introduction:
      '환영합니다! Nuphos가 드리는 첫 Box, 클라우드에 있는 컴퓨터예요. 무료 AI 체험 크레딧이 있으니 작은 일을 하나 맡겨 보고 Bot이 무엇을 할 수 있는지 확인해 보세요.',
    trial:
      '이 Box는 체험용이에요. 계속 사용하고 싶을 때 내 AI 구독을 연결하거나, 지금 쓰고 있는 이 컴퓨터를 사용하도록 도와드릴게요.',
    none: '먼저 어떤 일을 해 볼까요?',
    linear:
      'Linear를 고르셨네요. 아래 "Linear 연결"을 클릭하면 체험 크레딧으로 할 일 목록을 확인해 드릴게요.',
    picked: (names) =>
      `${names}을(를) 고르셨네요. 아래에서 연결할 도구를 고르면 체험 크레딧으로 작은 작업을 해 볼 수 있어요.`,
  },
  th: {
    join: ', ',
    introduction:
      'ยินดีต้อนรับ! นี่คือ Box เครื่องแรกที่ Nuphos มอบให้คุณ เป็นคอมพิวเตอร์บนคลาวด์ พร้อมเครดิตทดลองใช้ AI ฟรี ลองมอบงานเล็ก ๆ ให้ฉันสักงาน แล้วดูว่า Bot ช่วยอะไรคุณได้บ้าง',
    trial:
      'Box เครื่องนี้ให้คุณทดลองใช้ชั่วคราว เมื่ออยากใช้งานต่อ ฉันช่วยเชื่อมต่อการสมัครสมาชิก AI ของคุณเอง หรือใช้คอมพิวเตอร์เครื่องที่คุณใช้อยู่ตอนนี้ได้',
    none: 'อยากลองงานไหนก่อนดี?',
    linear:
      'คุณเลือก Linear คลิก "เชื่อมต่อ Linear" ด้านล่าง แล้วฉันจะใช้เครดิตทดลองดูว่าคุณมีงานอะไรค้างอยู่บ้าง',
    picked: (names) =>
      `คุณเลือก ${names} เลือกเครื่องมือที่อยากเชื่อมต่อด้านล่าง แล้วลองงานเล็ก ๆ ด้วยเครดิตทดลองได้เลย`,
  },
  id: {
    join: ', ',
    introduction:
      'Selamat datang! Ini Box pertama Anda dari Nuphos, sebuah komputer di cloud. Box ini dilengkapi kredit uji coba AI gratis, jadi Anda bisa memberi saya satu tugas kecil dan melihat apa yang bisa dilakukan Bot.',
    trial:
      'Box ini untuk dicoba dulu. Saat Anda ingin lanjut, saya bisa membantu menghubungkan langganan AI Anda sendiri, atau memakai komputer yang sedang Anda gunakan sekarang.',
    none: 'Apa yang ingin Anda coba dulu?',
    linear:
      'Anda memilih Linear. Klik Hubungkan Linear di bawah untuk memakai kredit uji coba melihat daftar tugas Anda.',
    picked: (names) =>
      `Anda memilih ${names}. Pilih alat di bawah untuk menghubungkannya dan coba tugas kecil dengan kredit uji coba Anda.`,
  },
  es: {
    join: ', ',
    introduction:
      '¡Te damos la bienvenida! Este es tu primer Box, una computadora en la nube de Nuphos. Incluye crédito de prueba de IA gratis, así que puedes darme una tarea pequeña y ver lo que puede hacer un Bot.',
    trial:
      'Este Box es para que lo pruebes por ahora. Cuando quieras seguir, te ayudo a conectar tu propia suscripción de IA o a usar esta computadora que estás usando ahora.',
    none: '¿Qué te gustaría probar primero?',
    linear:
      'Has elegido Linear. Haz clic en Conectar Linear abajo para usar tu crédito de prueba y ver tus tareas pendientes.',
    picked: (names) =>
      `Has elegido ${names}. Elige abajo una herramienta para conectarla y prueba una tarea pequeña con tu crédito de prueba.`,
  },
}

/**
 * The Box wording for a Bot on the free computer (OpenCode); the own-computer
 * wording, naming its runtime, for one on this computer's Claude Code or Codex.
 */
export function starterGreeting(
  locale: string,
  connectors: readonly string[],
  agentRuntime: string,
) {
  const words = WORDS[locale] ?? WORDS.en
  const runtime = LOCAL_RUNTIME_NAMES[agentRuntime]
  const local = runtime ? (LOCAL_WORDS[locale] ?? LOCAL_WORDS.en) : null
  const linear = local?.linear ?? words.linear
  const picked = local?.picked ?? words.picked
  let invitation = words.none

  if (connectors.length === 1 && connectors[0] === 'Linear') invitation = linear
  else if (connectors.length) invitation = picked(connectors.join(words.join))

  const opening =
    local && runtime
      ? [local.introduction(runtime), local.usage(runtime)]
      : [words.introduction, words.trial]

  return [...opening, invitation].join('\n\n')
}
