# Bot Tasks interaction audit and native prototype

Review target: nuphos/nuphos main at `4c7e2cba6bbda31563490a0d93f48ef4f7432d59`. Design study only; no implementation approval requested.

## Current end-to-end routes

| Platform | Open the Bot | Reach dispatched Tasks | Reach the Bot's own Task | Return |
| --- | --- | --- | --- | --- |
| Desktop | Select Bot in Bots sidebar → Bot message page | Unfold Bot in the same sidebar → select child → full Task in current content area | Bot toolbar's runtime-mark “Task” action → full Task over Bot content; original content remains underneath | Own Task's explicit Back closes that surface and restores the Bot. Selecting another sidebar resource changes the resource and clears the temporary Task. Child Task selection uses normal sidebar navigation; no invented Bot visit in history. |
| iPhone / compact Duo | Bots list → tap Bot row → message page | No entry inside Bot page today. Back to Bots list → unfold Bot using count → select child → full Task | No equivalent Bot-page entry | Child selected from list returns to that list. This is a different starting route from Desktop's own-Task view. |
| Expanded Duo | Existing Bots list remains beside selected Bot page | Unfold Bot in left list → select child → right-hand Task | No equivalent Bot-page entry | Select Bot in left list to return to its message page. The list does not become a second workspace. |

Source: `HomeView`, `HomeColumns`, `AgentPage`, `ConversationNesting`, `ChannelView`, `ConversationRow`, `ConversationView`, Desktop `ChannelPane`, `BotTaskButton`, `WorkspaceConversationSurface`, `BotTaskMode`.

Current fold behavior matters: a Bot never opened starts folded; an explicitly opened Bot is now remembered across page changes and restarts, per #2898. The earlier assertion that all folds reset is obsolete.

## Patterns that constrain this design

| Pattern | Existing rule | Consequence for the design |
| --- | --- | --- |
| Navigation | A sidebar/list selects a resource; a temporary detail opened from a Bot has a return to the Bot | Do not replace global navigation with a new Tasks workspace |
| Rows | `ConversationRow` has runtime mark, title, metadata, existing activity indicators | Use that row for the own Task and dispatched Tasks; same tap behavior, no special card |
| Hierarchy | Bot ownership follows nearest Bot; deeper Tasks retain parent relationships | Do not flatten all descendants into an arbitrary newest-first list |
| Identity | `ChannelRow`/Bot header use Bot identity; Task selection rows use runtime mark even for a Bot's own Task | Difference follows purpose, not screen size. Do not “fix” consistency by putting Bot avatars on every Task row |
| Task title | Existing `ConversationView` owns its title, runtime information and task actions | Reuse it; do not draw a new “main work” header or rename the resource |
| Back | Returns through the entry route, rather than always jumping to a Bot because of ownership | Picker dismiss is not a history step; direct list/notification navigation stays intact |
| Duo | One `NavigationSplitView`, collapsed or wide; sidebar stays except existing runtime desktop presentation | Preserve the same selected resource and entry route; never auto-select own Task on expansion |
| Desktop pane | Existing desktop/dock behavior reserves the content space it needs | No extra third Tasks column; do not override desktop presentation |
| Actions | Closing a sheet cancels choosing; changing size is not choosing | No navigation on dismissal/fold, no implicit row selection |
| State | A retained origin must retain draft and reading position | Test returning to the same Bot; do not reconstruct a fresh page with empty state |
| Access | A reachable Bot message page does not prove permission to read its backing Task | Use existing access checks, no destination substitution on failure |
| Empty/loading | Missing dispatched work does not mean no own Task; missing page data does not mean an empty list | Keep accessible own Task; explicit loading/error, no false empty success |
| Typography and controls | Native text styles, dynamic type, standard toolbar and list hit regions | Avoid custom tiny count pills, fake status rows or manually packed controls |

## Where the rejected draft broke those patterns

1. It had two navigation roots: a sheet in compact and a replacement Tasks workspace in expanded.
2. It auto-opened the own Task in expanded while requiring an explicit tap in compact.
3. It styled the own Task as special “Main work”, flattened child ancestry, and introduced status copy outside the current row system.
4. It used a count that excluded the own Task on a button whose contents included it.
5. It provided pictures of destinations without demonstrating return, cancel, repeated entry or layout changes.
6. It proposed an invented fold divider instead of deriving the actual split presentation from the system.
7. It treated Paper/Chrome rendering similarity as relevant completion evidence even though the missing validation was native navigation.

Runtime marks for Task rows and a Bot face on the Bot page are not themselves a bug; `ConversationRow` explicitly uses runtime marks for all Tasks. The mistake was making identity and row treatment look accidental and inconsistent, rather than reusing those exact components.

## Smallest candidate being prototyped

Keep the existing home list, Bot page and full Task page. Add only a Tasks toolbar entry and an adaptive chooser. The chooser uses the existing Task row for every selection, grouped as Bot's Task and Dispatched Tasks; preserve child hierarchy. No auto-selection, counts, custom status system, new workspace or permanent third column. Selecting dismisses the chooser and pushes the existing Task view. Back restores the originating Bot; closing the chooser changes nothing. In expanded Duo, the original sidebar remains.

The prototype is isolated, uses offline fictional data and a debug-only launch argument. It is a way to test the candidate, not production implementation. Pagination, access refresh and layout-change state restoration are not solved by the prototype and must not be described as verified unless exercised.

## Native validation and remaining gate

The isolated SwiftUI prototype now gives the existing detail column an explicit navigation stack. The first attempt presented the chooser but did not navigate to its selected Task; that failed test was fixed before capturing the delivered route. Both own and child selections use the same push action and the same existing `ConversationView`.

Passed offline UI tests on iPhone 18 Pro (iOS 27.0), iPhone Duo's compact display (iOS 27.1), and a separate iPad mini (iOS 27.0) wide-layout control: current list route; proposed own Task; Back; repeated picker entry; dispatched Task; Back; Done/cancel; return to list where compact. These tests check navigation, not live server correctness. The Duo test locates the system Back control outside the top navigation bar, where this system places it.

The wide-control screenshots are from an iPad, **not from the Duo's expanded display**. They demonstrate that the native split navigation can keep the original sidebar and replace only the detail, with a transient chooser. The installed Duo simulator did not expose a documented fold/posture operation through the available headless CLI. Changing display power was not a fold transition and initially prevented the test runner from launching; default display state was restored. Its second screenshot surface was black, and is not included as evidence. Actual Duo expansion/collapse, reserved division handling, and state continuity across a physical mode change remain unverified. No new approval request should be opened on the strength of the iPad control.

## Required transitions and state contract

| Entry/event | Result | Back/cancel |
| --- | --- | --- |
| Bots row | Existing Bot message page | Existing return to list in compact; same sidebar in wide |
| Bot toolbar Tasks | Transient chooser, no selected Task | Done / outside dismissal changes nothing |
| Own Task or dispatched Task row | Dismiss chooser; open that full Task in the same detail history | Back restores originating Bot, not chooser |
| Child selected directly in Bots tree | Existing direct list-to-Task route | Existing list return; do not invent an intervening Bot visit |
| Select a different sidebar resource while in a temporary Task | Switch resource and discard the temporary route | Never return into a stale Bot |
| Compact ↔ expanded with Task open | Preserve selected Task and origin; only presentation changes | Same return destination |
| Compact ↔ expanded with chooser open | Adapt sheet/popover; no selection implied | Closing remains cancel |
| Task unreadable or removed | Existing unavailable/error treatment, with a usable return | Never substitute Bot message page or another Task |

No new active-count semantics, renamed “Main work” card, global Tasks workspace, third column, or default own-Task selection is proposed. Existing Task metadata and status indicators remain the source of truth. No change to Desktop is proposed.

Before an implementation handoff, the design still needs a real expanded Duo sequence and a fold/unfold continuity check. Keyboard/draft retention, long titles/larger text, empty/loading/unavailable lists, nested folding and complete paginated data were not exercised by this small fixture. They are review requirements, not claims of completed tests. The chooser must not treat “not in the currently loaded page” as “no Task exists”; its own-Task access is independent of child pagination.
