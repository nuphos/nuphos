type LocalWords = {
  introduction: (runtime: string) => string
  usage: (runtime: string) => string
  linear: string
  picked: (names: string) => string
}

/** The runtimes a first Bot can be placed on on the user's own computer, as people know them. */
export const LOCAL_RUNTIME_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

/**
 * The starter Bot's first message when it runs on this computer's own Claude
 * Code or Codex: no Box, gift or trial credit, and the usage is on their plan.
 */
export const LOCAL_WORDS: Record<string, LocalWords> = {
  en: {
    introduction: (runtime) =>
      `Welcome! I’m your first Bot. I work in ${runtime} on this computer, signed in with your own account, so you can give me a small task and see what a Bot can do.`,
    usage: (runtime) =>
      `What I do uses your own ${runtime} plan, just like when you use it yourself. This computer needs to be on and online for me to reply.`,
    linear:
      'You picked Linear. Click Connect Linear below, and I’ll take a look at what’s on your to-do list.',
    picked: (names) =>
      `You picked ${names}. Pick a tool below to connect it, and we can try a small task together.`,
  },
  'zh-TW': {
    introduction: (runtime) =>
      `歡迎！我是你的第一個 Bot，在這台電腦的 ${runtime} 上工作，用的是你自己的帳號。你可以先交給我一件小事，看看 Bot 能怎麼幫你。`,
    usage: (runtime) =>
      `我做的事會用到你自己的 ${runtime} 方案，跟你平常自己用一樣。這台電腦要開著、連上網路，我才能回覆你。`,
    linear: '你剛才選了 Linear。點下方的「連接 Linear」，我就幫你看看手上有哪些待辦。',
    picked: (names) => `你剛才選了${names}。選下方想連接的工具，我們就能一起跑一個小任務。`,
  },
  'zh-CN': {
    introduction: (runtime) =>
      `欢迎！我是你的第一个 Bot，在这台电脑的 ${runtime} 上工作，用的是你自己的账号。你可以先交给我一件小事，看看 Bot 能怎么帮你。`,
    usage: (runtime) =>
      `我做的事会用到你自己的 ${runtime} 套餐，跟你平常自己用一样。这台电脑要开着、连上网络，我才能回复你。`,
    linear: '你刚才选了 Linear。点下方的“连接 Linear”，我就帮你看看手上有哪些待办。',
    picked: (names) => `你刚才选了${names}。选下方想连接的工具，我们就能一起跑一个小任务。`,
  },
  ja: {
    introduction: (runtime) =>
      `ようこそ！あなたの最初の Bot です。このコンピュータの ${runtime} で、あなた自身のアカウントを使って動いています。まずは小さな作業を任せて、Bot に何ができるか試してみてください。`,
    usage: (runtime) =>
      `私の作業には、ふだんご自身で使うときと同じく、あなたの ${runtime} のプランが使われます。返信するには、このコンピュータが起動していてオンラインである必要があります。`,
    linear:
      'Linear を選びましたね。下の「Linear を接続」をクリックすると、あなたの ToDo を確認します。',
    picked: (names) =>
      `${names} を選びましたね。下から接続したいツールを選ぶと、一緒に小さな作業を試せます。`,
  },
  ko: {
    introduction: (runtime) =>
      `환영합니다! 저는 첫 번째 Bot이에요. 이 컴퓨터의 ${runtime}에서 본인 계정으로 일해요. 작은 일을 하나 맡겨 보고 Bot이 무엇을 할 수 있는지 확인해 보세요.`,
    usage: (runtime) =>
      `제가 하는 일에는 직접 쓰실 때와 똑같이 본인의 ${runtime} 요금제가 사용돼요. 제가 답하려면 이 컴퓨터가 켜져 있고 인터넷에 연결되어 있어야 해요.`,
    linear: 'Linear를 고르셨네요. 아래 "Linear 연결"을 클릭하면 할 일 목록을 확인해 드릴게요.',
    picked: (names) =>
      `${names}을(를) 고르셨네요. 아래에서 연결할 도구를 고르면 함께 작은 작업을 해 볼 수 있어요.`,
  },
  th: {
    introduction: (runtime) =>
      `ยินดีต้อนรับ! ฉันคือ Bot ตัวแรกของคุณ ทำงานอยู่บน ${runtime} ในคอมพิวเตอร์เครื่องนี้ด้วยบัญชีของคุณเอง ลองมอบงานเล็ก ๆ ให้ฉันสักงาน แล้วดูว่า Bot ช่วยอะไรคุณได้บ้าง`,
    usage: (runtime) =>
      `งานที่ฉันทำจะใช้แพ็กเกจ ${runtime} ของคุณเอง เหมือนตอนที่คุณใช้เอง คอมพิวเตอร์เครื่องนี้ต้องเปิดอยู่และเชื่อมต่ออินเทอร์เน็ต ฉันถึงจะตอบคุณได้`,
    linear:
      'คุณเลือก Linear คลิก "เชื่อมต่อ Linear" ด้านล่าง แล้วฉันจะดูว่าคุณมีงานอะไรค้างอยู่บ้าง',
    picked: (names) =>
      `คุณเลือก ${names} เลือกเครื่องมือที่อยากเชื่อมต่อด้านล่าง แล้วเราจะลองงานเล็ก ๆ ด้วยกัน`,
  },
  id: {
    introduction: (runtime) =>
      `Selamat datang! Saya Bot pertama Anda. Saya bekerja di ${runtime} pada komputer ini dengan akun Anda sendiri, jadi Anda bisa memberi saya satu tugas kecil dan melihat apa yang bisa dilakukan Bot.`,
    usage: (runtime) =>
      `Pekerjaan saya memakai paket ${runtime} Anda sendiri, sama seperti saat Anda memakainya sendiri. Komputer ini perlu menyala dan terhubung ke internet agar saya bisa membalas.`,
    linear:
      'Anda memilih Linear. Klik Hubungkan Linear di bawah, dan saya akan melihat daftar tugas Anda.',
    picked: (names) =>
      `Anda memilih ${names}. Pilih alat di bawah untuk menghubungkannya, lalu kita bisa mencoba tugas kecil bersama.`,
  },
  es: {
    introduction: (runtime) =>
      `¡Te damos la bienvenida! Soy tu primer Bot. Trabajo en ${runtime} en esta computadora, con tu propia cuenta, así que puedes darme una tarea pequeña y ver lo que puede hacer un Bot.`,
    usage: (runtime) =>
      `Lo que hago usa tu propio plan de ${runtime}, igual que cuando lo usas tú. Esta computadora tiene que estar encendida y conectada a internet para que pueda responderte.`,
    linear:
      'Has elegido Linear. Haz clic en Conectar Linear abajo y revisaré tus tareas pendientes.',
    picked: (names) =>
      `Has elegido ${names}. Elige abajo una herramienta para conectarla y probamos juntos una tarea pequeña.`,
  },
}
