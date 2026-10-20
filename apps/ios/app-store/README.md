# App Store screenshots

`published.txt` is the release source of truth: `<display type> <sha256> <url>` in App Store order.
The release workflow downloads and validates each image, replaces the screenshot sets, and
compares their names, order and checksums before submitting the version for review.

## Approved iPhone set — October 20, 2026

The approved light-appearance set uses the new Nuphos hero artwork, larger descriptions,
no top wordmark or eyebrow label, and a complete phone frame for the agent picker.
All four images are 1320 × 2868, opaque RGB PNGs. The existing iPad set remains unchanged.

| Image | Message |
| --- | --- |
| [01-workspace.png](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/2026-10-20-light-v3/01-workspace.png) | Your team. In your pocket. |
| [02-keep-going.png](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/2026-10-20-light-v3/02-keep-going.png) | Away from your desk. Not from your work. |
| [03-together.png](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/2026-10-20-light-v3/03-together.png) | Great work. Made together. |
| [04-your-agents.png](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/2026-10-20-light-v3/04-your-agents.png) | Your agents. Your subscriptions. |

[Contact sheet](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/2026-10-20-light-v3/preview-light-v3.png) · [Source archive](https://cdn.zeabur.com/nuphos/app-store/ios/en-US/2026-10-20-light-v3/nuphos-ios-light-v3.zip)

The source archive contains the renderer, HTML UI port, assets, finished PNGs and validation
results. It requires Chromium, Node.js and Apple SF Pro Text (not redistributed; obtain from
https://developer.apple.com/fonts/ and pass `SF_FONT_DIR`). This set was rendered on Linux with
SF Pro Text and exported SF Symbols outlines. It has not received a new simulator pixel-diff
check; font rasterization and symbol weights may differ from the native app. Marketing callouts
sit outside the app UI. All conversation data is fictional.

## Existing renderer and iPad set

The `compose.mjs`, `ui.js`, `data.js`, `symbols.swift`, `hero.mjs` and `faces/` files in this
directory remain the earlier dark-appearance renderer. They do not reproduce the new iPhone
set; use the dated source archive above for that set. The existing iPad images remain under
`https://cdn.zeabur.com/nuphos/app-store/ios/en-US/ipad/`.

On macOS with Google Chrome:

```sh
bash setup.sh
node compose.mjs ipad
```

For future revisions, upload images to a new dated CDN path and update `published.txt` together
with their SHA-256 hashes. Do not overwrite files referenced by an older release manifest.
Changing this manifest stages screenshots for a subsequent iOS release; it does not change an
already-live App Store version.
