// The secure input card's side of `request_user_decision`: one secret, or the
// details a website's form needs, asked together.
import { z } from 'zod'

/** A secret's name: also the file name it is written to on the runtime. */
export const SECRET_NAME = /^[A-Za-z]\w{0,63}$/

/** One input of a secure card that asks for several: its file name and what the person reads. */
const SECRET_FIELD = z
  .object({
    name: z.string().regex(SECRET_NAME),
    label: z.string().trim().min(1).max(80),
  })
  .strict()

export type SecretField = z.infer<typeof SECRET_FIELD>

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** A site as the card shows it: a lowercase host name and, if not the default, a port. No scheme or path. */
export function isSiteHost(site: unknown): site is string {
  if (typeof site !== 'string' || site.length > 253) return false
  const host = /^([a-z0-9.-]+)(?::[1-9]\d{0,4})?$/.exec(site)?.[1]
  const labels = host?.split('.') ?? []

  return host === 'localhost' || (labels.length > 1 && labels.every((l) => HOST_LABEL.test(l)))
}

/**
 * The page origins a site means: its HTTPS origin, compared whole (scheme, host
 * and port). A page served from this computer itself may also be plain HTTP.
 */
export function siteOrigins(site: string): string[] {
  const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(site)

  return [`https://${site}`, ...(local ? [`http://${site}`] : [])]
}

/** A credential request's `fields`, when they are what its secure card can draw. */
export function parseSecretFields(value: unknown): SecretField[] | undefined {
  const parsed = z.array(SECRET_FIELD).min(1).max(6).safeParse(value)

  return parsed.success ? parsed.data : undefined
}

/** The request as plain text asks it, where no secure input card is drawn. */
export function withoutSecretCard(input: Record<string, unknown>): Record<string, unknown> {
  const { secretName: _secretName, fields: _fields, site: _site, ...plain } = input

  return plain
}

/** A request's `fields` and `site` as its record keeps them; nothing unless it may ask them. */
export function secretFieldsOf(input: {
  category?: unknown
  secretName?: unknown
  fields?: unknown
  site?: unknown
}): { fields?: SecretField[]; site?: string } {
  const fields = secretFieldsProblem(input) === null ? parseSecretFields(input.fields) : undefined

  return fields && typeof input.site === 'string' ? { fields, site: input.site } : {}
}

/**
 * Why a credential request's `fields` cannot be asked. They always come with a
 * `secretName`: an app that predates `fields` then still draws its masked
 * input for that name, never a question the person would answer by typing the
 * details into the chat.
 */
export function secretFieldsProblem(input: {
  category?: unknown
  secretName?: unknown
  fields?: unknown
  site?: unknown
}): string | null {
  if (input.fields === undefined && input.site === undefined) return null
  if (input.category !== 'credential') return '`fields` and `site` belong to category `credential`.'
  if (typeof input.secretName !== 'string')
    return 'Pass `secretName` with `fields`: it names the request, and an older app asks for that one value instead.'
  if (input.fields === undefined || !isSiteHost(input.site))
    return 'Pass `fields` together with `site`, the lowercase host name they are entered on, e.g. www.example.com.'
  const fields = parseSecretFields(input.fields)

  if (!fields) return '`fields` takes one to six {name, label} entries.'
  if (new Set(fields.map((field) => field.name.toLowerCase())).size !== fields.length)
    return 'Each of `fields` needs its own `name`.'

  return null
}

/** The fields `request_user_decision` takes for a secure input card. */
export const secretSchema = {
  secretName: z
    .string()
    .regex(SECRET_NAME)
    .optional()
    .describe(
      'With category `credential`: an environment-variable style name for the secret the user types, e.g. OPENAI_API_KEY. With `fields`, a name for the whole request, e.g. CLINIC_LOOKUP.',
    ),
  fields: z
    .array(SECRET_FIELD)
    .min(1)
    .max(6)
    .optional()
    .describe(
      "With `secretName`: the details a website's form needs from the user, each with a `name` (environment-variable style, its file name) and a `label` in the user's language that says what to type and in which format.",
    ),
  site: z
    .string()
    .refine(isSiteHost)
    .optional()
    .describe(
      "With `fields`: the host name of the site they will be entered on, lowercase, exactly as the page's address has it, e.g. www.example.com (add :port only when the address has one). The card shows it to the user, and `fill` enters the values only on a page of that site.",
    ),
}

const SECRET_INSTRUCTION =
  'The user sees a secure input card below your message; point to it in one short sentence that refers to "the card below" (never "above"). Their answer, a new message, gives the path of a file holding the value: read it only inside the command that needs it, e.g. "$(cat <path>)", and never print, echo or copy its contents.'

/** What the agent does once a card with `fields` is asked, and with its answer. */
const SECRET_FIELDS_INSTRUCTION =
  'The user sees a secure input card below your message that lists these fields and names the site; point to it in one short sentence that refers to "the card below" (never "above"). ' +
  'Their answer, a new message, lists one file per field as `NAME: path`: continue the task then, without waiting to be asked. ' +
  'Enter the values with local_browser `fill`, passing each path with the selector of its input; `fill` reads the files itself, so the values never pass through you, and it refuses a tab that is not on the `site` the card named. ' +
  'Never read, print, echo or copy the files, never put a value in an `eval` script, and do not read the filled inputs back from the page. ' +
  'If the answer gives a single path and lists no fields, the user is on an older app that cannot draw several: ask for each field in its own card, with only `secretName`.'

/** What the agent does once a secure input card is asked, and with its answer. */
export function secretInstruction(fields: SecretField[] | undefined): string {
  return fields ? SECRET_FIELDS_INSTRUCTION : SECRET_INSTRUCTION
}
