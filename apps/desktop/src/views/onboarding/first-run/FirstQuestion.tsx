import { ChevronDown } from 'lucide-react'

import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../../components/ui/menu'
import {
  FIRST_RUN_PROMPT_LANGS,
  firstRunLandingPrompt,
  firstRunVocabulary,
} from '../../../lib/firstRunConnect'

import { Reveal, StepRow } from './bits'
import { CopyQuestionButton } from './journey'
import { WIRING } from './progress'
import { SavingsPreview } from './savings-preview'

import type { FirstRunPromptLang, FirstRunProvider } from '../../../lib/firstRunConnect'

// The last screen: cash in the connection. It opens by closing the loop the
// intro opened — "find out where you're overspending" was the promised win,
// and this question is that win, ready to ask. The pinned journey strip above
// carries the macro state (connect done, ask in flight), so the rest is
// nothing but step two's own moves. The payoff stays the user's move to
// make, deliberately: they navigate to the chat and paste the question
// themselves, so the first answer is something they asked for rather than
// something that happened to them.
export function FirstQuestion({
  provider,
  active,
  asked,
  answered,
  lang,
  onPickLang,
  onOpenAgentPage,
}: {
  provider: FirstRunProvider
  /** Whether the panel is open — pauses the chart loop while it isn't. */
  active: boolean
  /** The conversation arc, one flag per move — see the Stage type. */
  asked: boolean
  answered: boolean
  lang: FirstRunPromptLang
  onPickLang: (lang: FirstRunPromptLang) => void
  onOpenAgentPage: () => void
}) {
  const question = firstRunLandingPrompt(provider, lang)
  const v = firstRunVocabulary(provider)
  const identity = WIRING[provider].identity

  return (
    <div className="pt-3">
      <Reveal delay={0}>
        <p className="text-[12.5px] leading-relaxed text-secondary">
          You set this up to find out where you&apos;re overspending — that answer is now one
          question away. It&apos;s written for you below: {v.questionAsks}. Read-only, every word of
          it.
        </p>
      </Reveal>
      {/* The intro's chart, reprised: the promise was made over this picture,
          so it returns for the moment the promise gets cashed in. Same remount
          key as the intro — the panel stays mounted at width 0 when closed,
          and without it the first draw plays invisibly. */}
      <Reveal delay={0.1}>
        <SavingsPreview key={active ? 'open' : 'closed'} active={active} />
      </Reveal>

      <Reveal delay={0.22}>
        <div className="mt-4">
          <StepRow n={1}>
            Head to the{' '}
            <button
              type="button"
              onClick={onOpenAgentPage}
              className="text-zViolet-accent hover:underline"
            >
              Agent page
            </button>
            .
          </StepRow>
          <StepRow n={2}>Paste this into the chat:</StepRow>
          {/* Indented to the step text's left edge — the picker and the box
              are step 2's content, and hanging them under the number would
              read as siblings. */}
          <div className="ml-[26px] mt-2">
            <LangPicker lang={lang} onPick={onPickLang} />
          </div>
          <div className="relative ml-[26px] mt-1.5 rounded-md border border-zGray-800 bg-zGray-850 p-2.5">
            <p className="pr-6 text-[11.5px] leading-relaxed text-secondary">{question}</p>
            <CopyQuestionButton value={question} />
          </div>
          {/* The waiting lines carry their loading in text alone — the
              footer's spinner already says "in flight", a second spinner
              would just double it. */}
          <StepRow n={3}>
            {answered
              ? `Answer's in — ${v.answerNoun}, plus the exact ${v.grantNoun} the agent turned out to be missing.`
              : asked
                ? 'The agent is reading your bill and reaching for the resources behind it…'
                : `The agent answers with ${v.answerNoun} — and where the resources behind it sit past cost read, it names the ${v.grantNoun} it's missing.`}
          </StepRow>
          {answered ? (
            <Reveal delay={0}>
              <StepRow n={4}>
                If more access is needed, open the {v.label} console and update{' '}
                <span className="font-mono text-[11px] text-main">{identity}</span>
                &apos;s permissions, then ask the agent to try again.
              </StepRow>
            </Reveal>
          ) : null}
        </div>
      </Reveal>
    </div>
  )
}

// Sits above every prompt the guide hands out. One shared choice, not one per
// box: picking a language anywhere rewrites all of them — it is the same
// control shown wherever the user happens to be looking. Styled like a code
// block's language selector: a whisper of text and a chevron, because it
// annotates the prompt rather than competing with it.
function LangPicker({
  lang,
  onPick,
}: {
  lang: FirstRunPromptLang
  onPick: (lang: FirstRunPromptLang) => void
}) {
  const current = FIRST_RUN_PROMPT_LANGS.find((l) => l.id === lang) ?? FIRST_RUN_PROMPT_LANGS[0]

  return (
    <Menu>
      <MenuTrigger
        aria-label="Prompt language"
        className="flex h-5 items-center gap-1 rounded text-[10.5px] text-tertiary outline-none transition-colors hover:text-main"
      >
        {current.label}
        <ChevronDown className="h-3 w-3" strokeWidth={2} />
      </MenuTrigger>
      <MenuContent>
        {FIRST_RUN_PROMPT_LANGS.map((l) => (
          <MenuItem key={l.id} selected={l.id === lang} onClick={() => onPick(l.id)}>
            {l.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
