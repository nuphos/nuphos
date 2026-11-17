// `local_browser` `fill`: enters values a secure input card saved into a page,
// without them passing through the agent or the conversation, and only on the
// site the card named.
import { getReadableConversation } from '@/lib/agent/db'
import { siteOrigins } from '@/lib/agent/tools-skilled/decision-secrets'

import { readSavedSecret, SAVED_SECRET_PATH } from '../runtime-file'

import type { PreviewToolContext } from '../preview-tool-context'

/** One input `fill` sets: where it is on the page, and the saved file holding its value. */
export type FillField = { selector: string; path: string }

const isFillField = (field: unknown): field is FillField => {
  const { selector, path } = (field ?? {}) as Partial<FillField>

  return (
    typeof selector === 'string' &&
    selector.trim() !== '' &&
    selector.length <= 500 &&
    typeof path === 'string' &&
    path.length <= 4096
  )
}

/** Why a `fill` cannot run on the fields it names, if it cannot. */
export function fillProblem(fields: unknown): string | undefined {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 12)
    return 'fields is required: one to twelve {selector, path} entries.'
  if (!fields.every(isFillField)) return 'Each field needs a selector and a path.'
  if (!fields.every((field) => SAVED_SECRET_PATH.test(field.path)))
    return 'path must be a file the secure input card saved: pass it exactly as the answer gave it.'

  return undefined
}

/** A fill that may not happen, in words the agent can act on. They never carry a value. */
export class FillRefused extends Error {}

/** A saved value and the site its card named, read as the conversation's owner. */
export type ReadSecret = (
  ctx: PreviewToolContext,
  path: string,
) => Promise<{ value: string; site: string }>

export const readSecret: ReadSecret = async (ctx, path) => {
  const owner = ctx.conversationOwnerUserId ?? ctx.userId
  const conversation = await getReadableConversation(ctx.sessionId, owner, ctx.teamId)
  // The site is the server's own record of what the card showed, not what the agent says now.
  const site = conversation?.secretSites?.findLast((entry) => entry.path === path)?.site

  if (!site)
    throw new FillRefused(
      'This file was not saved for a website: fill enters only values a card asked for with `fields` and `site`. Ask for them again with request_user_decision.',
    )
  if (!conversation?.runtimeId) throw new Error('Conversation has no runtime')
  const value = await readSavedSecret(
    ctx.teamId,
    owner,
    conversation.runtimeId,
    ctx.sessionId,
    path,
  )

  return { value, site }
}

/**
 * The page script `fill` runs through `eval`. Before anything else it compares
 * the page's own origin, whole, with the origins the card's site means, and on
 * any other page (a redirect's target included) it stops without the values
 * ever being evaluated. Checking inside the page leaves no moment between the
 * check and the fill in which the tab could navigate. It then sets each input
 * the way typing does, so frameworks see the change, and reports only whether
 * each selector was filled: a value is never returned, and nothing is thrown
 * that could carry one.
 */
export function fillScript(
  fields: readonly { selector: string; value: string }[],
  site: string,
): string {
  return `(() => {
  if (!${JSON.stringify(siteOrigins(site))}.includes(location.origin))
    return { refused: 'This tab is on ' + location.origin + ', not ' + ${JSON.stringify(site)} + ', the site the card named. Nothing was entered.' };
  const fields = ${JSON.stringify(fields)};
  return fields.map(({ selector, value }) => {
    try {
      const element = document.querySelector(selector);
      if (!element) return { selector, filled: false, reason: 'no element matches' };
      if (!('value' in element)) return { selector, filled: false, reason: 'not an input' };
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      element.focus?.();
      if (setter) setter.call(element, value); else element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { selector, filled: element.value === value, ...(element.value === value ? {} : { reason: 'the page changed or refused the value' }) };
    } catch {
      return { selector, filled: false, reason: 'the page refused it' };
    }
  });
})()`
}

/** The script for one `fill`: every value read, and all of them asked for the same site. */
export async function fillScriptFor(
  ctx: PreviewToolContext,
  fields: readonly FillField[],
  read: ReadSecret,
): Promise<string> {
  const saved = await Promise.all(fields.map((field) => read(ctx, field.path)))
  const sites = new Set(saved.map((entry) => entry.site))
  const [site] = sites

  if (!site || sites.size !== 1)
    throw new FillRefused('These values were asked for different sites: fill one site at a time.')

  return fillScript(
    fields.map(({ selector }, index) => ({ selector, value: saved[index]?.value ?? '' })),
    site,
  )
}
