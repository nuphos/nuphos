# Bot Tasks navigation revision

Status: interaction proposal following rejected layouts; not approved for implementation. This replaces the interaction assumptions of the previous supplemental mockups, not the accepted requirement for a Tasks entry.

## What went wrong

The prior pictures treated compact and expanded as different products. Opening Tasks was a temporary chooser on one and a new list/detail workspace on the other. The expanded mock also chose the Bot's own Task without a user action. Neither picture established the full return journey. Export fidelity between Paper and HTML did not validate this interaction model.

## Existing relationships to preserve

- A Bot's message page and its own Task are two views of the same persistent Bot. The own Task exposes the full work transcript, tools and files; it is not a newly created child Task.
- Dispatched Tasks are separate work items owned by the Bot. Their existing identity, status and access remain unchanged.
- Desktop already opens the Bot's own Task over its message page and provides a return action (`BotTaskButton`, `BotTaskMode`).
- iOS already has one adaptive list/detail shell: compact navigates forward from the list, wide keeps the list beside the detail (`HomeView`, `HomeColumns`). Opening the runtime desktop already manages its own side-by-side presentation.

## Proposed flow

1. **Bot page.** Keep its title, Bot face, existing actions and composer. The new Tasks entry is a chooser, not a second navigation root. Use the text "Tasks" without a numeric badge: the old count excluded the own Task while the picker included it.
2. **Choose a Task.** Compact presents a sheet; expanded presents an anchored popover inside the current detail area. Both have the same contents and order: "Bot's Task" (runtime icon, Bot name), then "Dispatched Tasks" using the existing Task rows and done grouping. The Bot's own Task is not counted as dispatched work. No row is selected automatically. Closing the chooser leaves the Bot page exactly where it was.
3. **Open the selection.** Dismiss the chooser, then open the existing full Task page in the current detail navigation. The chosen task is the same resource whether reached from this picker or the Bots tree. Do not create a second Task page implementation or a second composer.
4. **Return.** A Task opened from the Bot returns to that Bot page, with its draft and reading position retained. The chooser is not a back-stack destination and does not reappear on Back. The next Back in compact returns to the original Bots list. Expanded keeps that original list visible throughout.
5. **Choose another Task.** Return to the Bot and reopen Tasks. No new persistent sub-navigation or extra Task switcher is introduced. If this proves too slow in the prototype, revisit it explicitly rather than quietly adding a second switching model.
6. **Existing direct entry.** Opening a Task directly from the Bots tree or a notification preserves that entry's existing navigation history. Do not fabricate a visit to the Bot page or rewrite the normal Back action just because the Task has a Bot owner.

## Duo transition contract

The selected resource, entry route, drafts, reading position and focused working surface survive a layout change. Size is presentation, not a navigation action.

| Current state | Compact → expanded | Expanded → compact |
| --- | --- | --- |
| Bot page | Reveal the existing Bots list beside the same Bot | Keep that Bot in the detail; list remains the return destination |
| Tasks chooser open | Same chooser contents in an anchored popover; nothing auto-opens | Same chooser contents in a sheet; dismiss still returns to the same Bot |
| Bot's own Task | Same own Task on the right, with return to the originating Bot | Same own Task and return route |
| Dispatched Task | Same selected Task on the right; preserve originating route | Same selected Task and return route |
| Runtime desktop open | Reuse the existing desktop presentation rules | Reuse the existing desktop presentation rules; do not discard its Task |

No layout change moves input into another resource. The design should not force keyboard focus into a newly visible sidebar or composer.

## Cases the revised prototype must show before approval

- Bot → chooser → own Task → Back → original Bot → Back → Bots.
- Bot → chooser → dispatched Task → Back → original Bot.
- Open chooser → dismiss, without changing current content or the draft.
- The same journeys with the existing Bots list visible on expanded Duo.
- Fold/unfold while on the Bot, while the chooser is open, and while reading either kind of Task.
- No dispatched Tasks: the accessible own Task remains reachable.
- Loading, permission denied and a Task removed since the list loaded: retain the current page, explain the failure, and never substitute another Task.
- Long titles, large text and keyboard-visible states: controls remain tappable; the header must not rely on squeezing all labels into one line.

This is a proposed interaction model, not a report that native transitions or persistence have been implemented/tested. The current saved UITest Bot-page reference is an older fixture, not evidence that the revised flow works. New screen designs should follow this full sequence and be checked against current native UI before another approval request.
