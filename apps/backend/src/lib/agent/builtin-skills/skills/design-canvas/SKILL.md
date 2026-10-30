---
name: design-canvas
description: Lay out, review and iterate on a product's screens on a Nuphos Design canvas — pages of live HTML frames, sections, notes and flow arrows that the team edits beside you. Use whenever asked to design screens, mock up a UI, put screens on a canvas, build a user flow, or change a frame on an open design.
---

# Design canvas

A **design** is a team document the user opens on the Designs page. It holds
**pages**; each page is one canvas of objects:

| type | what it is | required fields |
|---|---|---|
| `frame` | a screen: a complete HTML document shown live in a sandboxed iframe | `id, type, title, x, y, width, height, html` |
| `section` | a labelled area that groups related frames | `id, type, title, x, y, width, height, color?` |
| `note` | a sticky note | `id, type, text, x, y, width, height, color?` |
| `text` | a text label | `id, type, text, x, y, width, fontSize?, color?` |
| `shape` | `rect`, `ellipse`, `arrow` or `line` | `id, type, shape, x, y, width, height, color?, text?` |
| `ink` | a freehand stroke (people draw these; you rarely create one) | `id, type, x, y, width, height, points` |

**Links** are flow arrows between two frames on the same page:
`{ id, source: frameId, target: frameId, label? }` — "from this screen you get to that one".

Positions are absolute top-left canvas units; nothing nests. A frame sits in a
section when its rectangle falls inside the section's rectangle.

You edit through the Nuphos REST API; the canvas updates live while the user
has it open. Never paste the HTML into the chat, and do not use the `artifact`
tool for screens that belong on the canvas. **Do NOT create a plan** for design
work.

## API workflow

```bash
SCRIPT=skills/design-canvas/scripts/design-api.sh
bash "$SCRIPT" "$TEAM" GET                          # list designs
bash "$SCRIPT" "$TEAM" POST "" '{"name":"Onboarding"}'   # create → returns the design with its first page
WORK=$(mktemp -d)
bash "$SCRIPT" "$TEAM" GET "$DESIGN" > "$WORK/design.json"
bash "$SCRIPT" "$TEAM" POST "$DESIGN/ops" @"$WORK/ops.json"  # incremental edits (preferred)
bash "$SCRIPT" "$TEAM" PUT "$DESIGN" @"$WORK/pages.json"     # rename, or replace all pages (needs updatedAt)
```

| Action | Call |
|---|---|
| List | `GET /teams/{teamId}/designs` |
| Create | `POST …/designs` with `{ name?, pages? }` |
| Read | `GET …/designs/{designId}` |
| Edit | `POST …/designs/{designId}/ops` with `{ ops: [...] }` |
| Replace | `PUT …/designs/{designId}` with `{ name?, pages?, updatedAt? }` |
| Delete | `DELETE …/designs/{designId}`; only when explicitly asked |

**Prefer `ops`.** Each op touches only what it names, so your edit lands beside
whatever the user is moving on the canvas at the same moment. `PUT pages`
replaces every page, so it must carry the `updatedAt` from your last GET; if
anyone edited the design since, it answers `409 design_conflict` — GET again
and send `ops` instead. Use `PUT pages` only to lay out a brand-new, empty
design; `PUT { name }` alone renames without a lock.

Ops (`{ ops: [ … ] }`, applied in order, atomically):

```json
{ "op": "rename", "name": "Checkout" }
{ "op": "addPage", "page": { "id": "p2", "name": "Mobile" }, "after": "p1" }
{ "op": "renamePage", "pageId": "p2", "name": "Phone" }
{ "op": "deletePage", "pageId": "p2" }
{ "op": "reorderPages", "pageIds": ["p2", "p1"] }
{ "op": "upsertObjects", "pageId": "p1", "objects": [ { "id": "login", "type": "frame", … } ] }
{ "op": "deleteObjects", "pageId": "p1", "objectIds": ["login"] }
{ "op": "upsertLinks", "pageId": "p1", "links": [ { "id": "l1", "source": "login", "target": "home", "label": "Sign in" } ] }
{ "op": "deleteLinks", "pageId": "p1", "linkIds": ["l1"] }
```

`upsertObjects` replaces an object with the same `id` and appends a new one. To
change one frame's HTML, GET the design, find the frame, and upsert it with the
same `id` and the complete new `html`. Generate stable unique string ids
locally. Deleting a frame drops the links attached to it.

Link to the design in your answer so the user can open it:
`https://nuphos.ai/teams/<teamId>/designs/<designId>`.

## Frames

- A frame's `html` is **one complete document** with inline `<style>` and
  `<script>`. It runs in a sandbox with no access to Nuphos, the user's session,
  cookies or storage; it may load libraries from public https CDNs; links open in
  the user's browser.
- Size the frame like the device: phone `390×844`, tablet `834×1194`, desktop
  `1440×900`. Make the page fill the viewport (`html, body { margin: 0; min-height: 100% }`).
- Write real, finished-looking UI: typography, spacing, states. Each screen is
  one frame; a flow is several frames in a row, linked.
- When several screens share a visual system, keep the same CSS block at the top
  of each so they read as one product.
- Make the prototype clickable. Put `data-goto="<target frame id>"` on the
  element that causes each link's transition (the button, the card, the tab),
  with `cursor: pointer`; in Play mode clicking it opens that screen. Once a
  frame has any `data-goto`, only those elements navigate.
- Frames are live, so wire what happens within a screen with a small inline
  script: tabs, toggles, a selected payment method, a filled-in field. Keep a
  screen working on its own; it never needs another frame's state.

## Layout

- Lay a flow out left to right in the order the user walks through it, with a
  gap of about 120 units between frames; stack alternative paths below.
- Group each flow in a `section` (title it; leave ~60 units of padding and room
  for the header). Create the section first, then place its frames inside its
  rectangle.
- Put a `note` next to a frame for the open questions and the decisions made.
- Add a `link` for every real transition, label it with the action that causes it
  ("Tap Continue"). One link per transition; don't wire every frame to every frame.

## When asked to change a frame

1. GET the design; identify the frame(s) by the ids or titles the user gave.
2. Upsert each changed frame with its full new `html`, same `id`, same position
   unless asked to move it.
   Keep its `data-goto` hotspots unless the flow changed.
3. Say in one or two sentences what changed; do not paste the HTML.
