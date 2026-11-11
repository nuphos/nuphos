import { z } from 'zod'

export const BUNDLE_LIMITS = {
  uploadBytes: 100 * 1024 * 1024,
  expandedBytes: 500 * 1024 * 1024,
  fileBytes: 25 * 1024 * 1024,
  manifestBytes: 5 * 1024 * 1024,
  entries: 10_000,
  ratio: 100,
} as const

const key = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64)
const name = z.string().trim().min(1).max(120)
const instruction = z.string().max(8000)
const memory = z.string().trim().min(1).max(500)

export function bundlePath(path: string): boolean {
  const parts = path.split('/')

  return (
    path.length > 0 &&
    path.length <= 512 &&
    !/[\\:]/u.test(path) &&
    !/\p{Cc}/u.test(path) &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
    !parts.some(
      (part) =>
        /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    ) &&
    !parts.some((part) => /^(?:\.env.*|\.git|node_modules)$/iu.test(part)) &&
    !/(?:private.*key|\.(?:zip|tar|tgz|gz|7z|rar|pem|key))$/iu.test(path)
  )
}

const path = z.string().refine(bundlePath, 'Unsafe bundle path')
const timeZone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format()

      return true
    } catch {
      return false
    }
  }, 'Invalid IANA time zone')

const schedule = z
  .object({
    key,
    name,
    prompt: instruction.min(1),
    requestedEnabled: z.boolean().default(false),
    timeZone,
    schedule: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('cron'), expression: z.string().min(1).max(200) }).strict(),
      z
        .object({
          kind: z.literal('interval'),
          seconds: z
            .number()
            .int()
            .min(180)
            .max(365 * 86400),
        })
        .strict(),
    ]),
  })
  .strict()

const manualTask = z.object({ name, prompt: instruction, reason: z.string().max(1000) }).strict()
const setup = {
  key,
  name,
  instructions: instruction.default(''),
  memories: z.array(memory).max(100).default([]),
  schedules: z.array(schedule).max(64).default([]),
  manualTasks: z.array(manualTask).max(100).default([]),
}

const bot = z
  .object({
    ...setup,
    avatar: path.optional(),
    skills: z
      .array(z.object({ key, directory: path }).strict())
      .max(64)
      .default([]),
    files: z
      .array(z.object({ path, destination: path }).strict())
      .max(5000)
      .default([]),
  })
  .strict()

const chat = z
  .object({
    ...setup,
    members: z.array(key).min(1).max(100),
    lead: key.optional(),
  })
  .strict()

export const botBundleSchema = z
  .object({
    format: z.literal('nuphos-bot-bundle'),
    version: z.literal(1),
    source: z
      .object({
        application: z.literal('grok-bot'),
        exportedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    bots: z.array(bot).min(1).max(100),
    chats: z.array(chat).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const unique = (keys: string[], label: string) => {
      if (new Set(keys).size !== keys.length)
        context.addIssue({ code: 'custom', message: `Duplicate ${label} key` })
    }

    unique(
      value.bots.map((item) => item.key),
      'Bot',
    )
    unique(
      value.chats.map((item) => item.key),
      'chat',
    )
    const bots = new Set(value.bots.map((item) => item.key))

    for (const item of [...value.bots, ...value.chats]) {
      unique(
        item.schedules.map((routine) => routine.key),
        'schedule',
      )
    }
    for (const item of value.bots) {
      unique(
        item.skills.map((skill) => skill.key),
        'skill',
      )
      unique(
        item.files.map((file) => file.destination.normalize('NFC').toLowerCase()),
        'file',
      )
    }
    for (const item of value.chats) {
      unique(item.members, 'member')
      if (item.members.some((member) => !bots.has(member)))
        context.addIssue({ code: 'custom', message: 'Chat member is not an exported Bot' })
      if (item.lead && !item.members.includes(item.lead))
        context.addIssue({ code: 'custom', message: 'Chat lead is not a member' })
    }
  })

export type BotBundle = z.infer<typeof botBundleSchema>
export type ImportedBot = BotBundle['bots'][number]
export type ImportedChat = BotBundle['chats'][number]
