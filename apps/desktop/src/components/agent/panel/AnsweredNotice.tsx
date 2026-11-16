import clsx from "clsx";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useContext, useId, useState } from "react";

import { t } from "../../../i18n";
import { MessageResponse } from "../MessageResponse";

import { parseChoiceRequest } from "./connectCardModel";
import { AskedCardsContext } from "./decisionAnswers";
import { ownBody } from "./decisionFormModel";
import { pickedOptions } from "./decisionNotice";
import { formatMessageTimestamp } from "./streamText";

import type { DecisionNotice } from "./decisionNotice";

/**
 * A question someone answered, for the people reading the conversation: one
 * line per question saying who answered what, which opens to the question as
 * it was asked. The agent gets the notice's own text; none of it is shown here.
 */
export function AnsweredNotice({
  notice,
  sentAt,
}: {
  notice: DecisionNotice;
  sentAt: string;
}) {
  const asked = useContext(AskedCardsContext).get(notice.requestId);
  // The card as it was asked, when this conversation asked it: the notice only excerpts it.
  const card = asked ? parseChoiceRequest(asked.input) : null;
  const times = {
    asked:
      asked?.askedAt === undefined
        ? undefined
        : formatMessageTimestamp(asked.askedAt),
    answered: formatMessageTimestamp(new Date(sentAt).getTime()),
  };

  return (
    <div className="flex flex-col gap-3">
      {notice.answers.map(({ question, answer }, index) => (
        <AnsweredLine
          key={`${String(index)}:${question}`}
          name={notice.answeredBy}
          question={question}
          answer={answer}
          body={card ? ownBody(card.body, card.questions) : notice.body}
          options={
            card?.questions?.[index]?.options ?? card?.options ?? notice.options
          }
          times={times}
        />
      ))}
    </div>
  );
}

/** "✓ Sam answered  Which region?  [ us-east ]  ⌄", and under it, once opened, the question's card. */
function AnsweredLine({
  name,
  question,
  answer,
  body,
  options,
  times,
}: {
  name: string;
  question: string;
  answer: string;
  body: string | undefined;
  options: readonly string[];
  times: { asked: string | undefined; answered: string };
}) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const picked = pickedOptions(options, answer);
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={cardId}
        onClick={() => setOpen((value) => !value)}
        className="-mx-2 flex min-h-7 max-w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[12.5px] leading-[18px] hover:bg-state-hover"
      >
        <Check className="size-3.5 shrink-0 text-tertiary" strokeWidth={2.2} />
        <span className="shrink-0 font-medium text-main">
          {t("{name} answered", { name })}
        </span>
        <span className="min-w-0 truncate text-tertiary">{question}</span>
        <span className="h-[22px] max-w-[50%] shrink-0 truncate rounded-md bg-state-selected px-2 leading-[22px] font-medium text-main">
          {answer}
        </span>
        <Chevron className="size-3.5 shrink-0 text-tertiary" strokeWidth={2} />
      </button>
      {open && (
        <div
          id={cardId}
          className="mt-2 rounded-[14px] bg-surface-raised px-4 pt-3.5 pb-3 shadow-[0_0_0_1px_rgb(var(--color-line-control)),0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <div className="selectable mb-1.5 whitespace-pre-wrap text-[16px] leading-[23px] font-semibold tracking-[-0.01em] text-main">
            {question}
          </div>
          {body && (
            <MessageResponse className="selectable text-[13.5px] text-secondary">
              {body}
            </MessageResponse>
          )}
          {options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {options.map((option) => (
                <Option key={option} chosen={picked.includes(option)}>
                  {option}
                </Option>
              ))}
            </div>
          )}
          {picked.length === 0 && (
            <div
              className={clsx(
                "selectable rounded-[9px] bg-[rgba(var(--color-text-primary),0.05)] px-3 py-2 text-[13.5px] leading-5 whitespace-pre-wrap text-main",
                options.length > 0 ? "mt-2" : "mt-3",
              )}
            >
              {answer}
            </div>
          )}
          <div className="mt-2.5 text-[12px] leading-4 text-tertiary">
            {times.asked
              ? t("Asked {asked} · Answered {answered} from the Inbox", {
                  asked: times.asked,
                  answered: times.answered,
                })
              : t("Answered {answered} from the Inbox", {
                  answered: times.answered,
                })}
          </div>
        </div>
      )}
    </div>
  );
}

/** An option as its button looked, for reading only: the chosen one filled, the rest dimmed. */
function Option({ chosen, children }: { chosen: boolean; children: string }) {
  return (
    <span
      className={clsx(
        "inline-flex min-h-8 items-center gap-1.5 rounded-[9px] px-[13px] py-1 text-[13px] font-medium",
        chosen
          ? "bg-action-primary text-inverse"
          : "bg-surface-raised text-main opacity-45 shadow-[0_0_0_1px_rgb(var(--color-line-control))]",
      )}
    >
      {chosen && <Check className="size-3.5 shrink-0" strokeWidth={2.6} />}
      {children}
    </span>
  );
}
