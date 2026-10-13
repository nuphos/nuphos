# App Store screenshots

The HTML that the iPhone 6.9" App Store screenshots (1320×2868, no alpha) are rendered from. The
finished images are not kept in git; the current set is on the CDN:

| Image                                         | Message                                      | What is lifted out of the screen                   |
| --------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| [`01-workspace.png`](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/01-workspace.png)   | The whole team's sessions in one workspace   | Two running sessions, one per agent                |
| [`02-keep-going.png`](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/02-keep-going.png) | Sessions keep running with the laptop closed | The "heading out" message and two status cards     |
| [`03-room.png`](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/03-room.png)             | Several people steer one agent               | Each teammate's message, with their photo and name |
| [`04-agents.png`](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/04-agents.png)         | Bring your own Claude or ChatGPT plan        | Two plan cards over the agent picker               |

## Rendering

macOS only: the port relies on SF Pro, SF Symbols and Georgia, and renders with the installed
Google Chrome.

```sh
bash setup.sh    # once: playwright-core, SF Symbols, hero frames -> build/
node compose.mjs  # writes build/screenshots/*.png and build/html/*.html
```

`setup.sh` captures the background from the live nuphos.ai hero shader, which animates, so a fresh
`build/` gives slightly different backgrounds than the published images.

After re-rendering, upload `build/screenshots/*.png` over the files in the `cdn` R2 bucket under
`nuphos/app-store/ios/en-US/`, which `cdn.zeabur.com` serves.

[`published.txt`](published.txt) lists the published images in App Store order, one `<sha256>  <url>` per line (`shasum -a 256 <file>`). A release fails if a download does not match its hash, so update the hash whenever an image is replaced. Every iOS release
(`release-ios.yml`) downloads them and replaces the version's iPhone 6.9" screenshot set before it
submits for review, so App Store Connect always shows this set. Add, remove or reorder a
screenshot by editing that file; the next release picks it up.

## Files

- `ui.js` — the iOS screens as HTML, in native points on a 440×956 canvas (dark appearance).
- `data.js` — the fictional conversations shown on the home screen.
- `compose.mjs` — headline, background, phone frame, and the lifted elements for each screenshot.
- `symbols.swift` — exports the SF Symbols the screens use, as PNG masks.
- `hero.mjs` — screenshots the nuphos.ai hero background with the page content hidden.
- `faces/` — sample profile photos from randomuser.me, keyed by initials.

## Keeping the port honest

`ui.js` is a hand port of SwiftUI, so it drifts when the app changes. Its metrics were measured
against simulator captures of a Debug build driven by a `NUPHOS_PREVIEW_RESPONSES` fixture
(`-preview-home`, plus `-open-first-chat` or `-new-chat "" -show-runtimes`) on iPhone 17 Pro Max,
then compared pixel by pixel at 3x. At the time of writing 1.7–3.8% of pixels differed by more
than 24 levels, mostly text anti-aliasing. Liquid Glass refraction is approximated, and the sender
row with a profile photo was laid out from `UserBubble` in `ConversationView.swift` rather than
captured. Re-measure the same way after changing the screens these port.

Everything shown is sample data. The lifted status cards, name tags and plan cards are marketing
elements that do not exist in the app.
