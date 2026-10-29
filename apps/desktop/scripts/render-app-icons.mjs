// Renders the selectable app icons for Desktop, iOS and Android from the shipped bot-avatar
// SVGs. Nothing is drawn by hand: each icon is one avatar placed by one of three layouts
// (the LogoFilm compositions in nuphos/studio) and frozen at a pose of the product's own
// idle loop. B2 is the bundled icon on every platform. Icon A, the original mark, is
// a committed asset and is not rendered here.
//
//   node apps/desktop/scripts/render-app-icons.mjs
//
// Needs Chrome or Chromium (set CHROME to its path if it is not found) and the desktop
// dependencies (sharp). Rerun after changing an avatar or a layout; commit the output.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(desktop, '../..')
const iosAssets = path.join(repo, 'apps/ios/nuphos-ios/Assets.xcassets')
const androidRes = path.join(repo, 'apps/android/app/src/main/res')

const CHARACTERS = {
  B: '14-napoleon.svg',
  C: '01-vermeer-girl.svg',
  D: '10-van-gogh.svg',
  E: '17-the-scream.svg',
  F: '20-son-of-man.svg',
}
// a: avatar canvas size / icon size; the canvas point `at` (in the 256 viewBox) lands at
// icon fraction `to`; k: seconds into the 6 s idle loop (1.5 = eyes left, 2.0 = right).
const LAYOUTS = {
  1: { a: 1.04, at: [109, 109], to: [0.5, 0.55], k: 0, field: ['#FFFDF8', '#F3EEE4'] },
  2: { a: 1.65, at: [106, 120], to: [0.58, 0.6], k: 1.5, field: ['#D9E5F1', '#B9CDE4'] },
  3: { a: 1.32, at: [109, 128], to: [0.5, 0.82], k: 2.0, field: ['#2A2A2A', '#101010'] },
}
const SIZE = 1024
// Android draws a 108 dp adaptive layer and shows the middle 72 dp, so the field bleeds a
// quarter of the icon size past it on every side.
const BLEED = SIZE / 4

// The macOS squircle (superellipse n = 5), in objectBoundingBox units.
const SQUIRCLE =
  'M' +
  Array.from({ length: 96 }, (_, i) => {
    const t = (i / 96) * Math.PI * 2
    const f = (v) => (0.5 + 0.5 * Math.sign(v) * Math.abs(v) ** (2 / 5)).toFixed(4)

    return `${f(Math.cos(t))} ${f(Math.sin(t))}`
  }).join('L') +
  'Z'

const { withBotAvatarMotion } = await import(path.join(desktop, 'src/lib/botAvatarMotion.ts'))

/** One icon on a canvas that adds `bleed` px of field around it. */
function page(file, layout, bleed, squircle) {
  const svg = fs.readFileSync(path.join(desktop, 'public/bot-avatars', file), 'utf8')
  // The product's idle loop, paused `k` seconds in.
  const posed = withBotAvatarMotion(svg, file, false)
    .replace(/<\?xml[^>]*>/, '')
    .replace(
      '</svg>',
      `<style>.bot-body,.bot-eye{animation-delay:-${String(layout.k)}s;animation-play-state:paused}</style></svg>`,
    )
    .replace('<svg ', '<svg width="100%" height="100%" ')
  const full = SIZE + bleed * 2
  const art = SIZE * layout.a
  const left = bleed + SIZE * layout.to[0] - (layout.at[0] / 256) * art
  const top = bleed + SIZE * layout.to[1] - (layout.at[1] / 256) * art
  const stop = (bleed / full) * 100

  return `<!doctype html><html><body style="margin:0;width:${full}px;height:${full}px;overflow:hidden;background:transparent">
<svg width="0" height="0" style="position:absolute"><clipPath id="sq" clipPathUnits="objectBoundingBox"><path d="${SQUIRCLE}"/></clipPath></svg>
<div style="position:relative;width:${full}px;height:${full}px;overflow:hidden;${squircle ? 'clip-path:url(#sq);' : ''}background:linear-gradient(180deg,${layout.field[0]} ${stop}%,${layout.field[1]} ${100 - stop}%)">
<div style="position:absolute;left:${left}px;top:${top}px;width:${art}px;height:${art}px;line-height:0">${posed}</div></div></body></html>`
}

function chrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ]
  const found = candidates.find((c) => c && fs.existsSync(c))

  if (!found) throw new Error('Chrome not found; set CHROME to its path')

  return found
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-icons-'))

function screenshot(html, size) {
  const input = path.join(tmp, 'page.html')
  const output = path.join(tmp, 'shot.png')

  fs.writeFileSync(input, html)
  execFileSync(
    chrome(),
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${String(size)},${String(size)}`,
      `--screenshot=${output}`,
      `file://${input}`,
    ],
    { stdio: 'ignore' },
  )

  return fs.readFileSync(output)
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

// macOS icons keep the squircle at 824 of 1024 px with a transparent margin; full-bleed art
// sits larger than every other icon in the Dock.
const MAC_MARGIN = 100

function macGrid(png) {
  return sharp(png)
    .resize(SIZE - MAC_MARGIN * 2)
    .extend({
      top: MAC_MARGIN,
      bottom: MAC_MARGIN,
      left: MAC_MARGIN,
      right: MAC_MARGIN,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
}

const json = (value) => JSON.stringify(value, null, 2) + '\n'
const xcode = { author: 'xcode', version: 1 }

const BUNDLED = 'B2'

async function writeIos(id, square) {
  const png = await sharp(square).flatten().png().toBuffer()
  const set = id === BUNDLED ? 'AppIcon' : `AppIcon-${id}`

  write(path.join(iosAssets, `${set}.appiconset/icon-1024.png`), png)
  write(
    path.join(iosAssets, `${set}.appiconset/Contents.json`),
    json({
      images: [
        { filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      ],
      info: xcode,
    }),
  )
  write(
    path.join(iosAssets, `AppIconPreview/AppIconPreview-${id}.imageset/preview.png`),
    await sharp(png).resize(180).png().toBuffer(),
  )
  write(
    path.join(iosAssets, `AppIconPreview/AppIconPreview-${id}.imageset/Contents.json`),
    json({ images: [{ filename: 'preview.png', idiom: 'universal', scale: '3x' }], info: xcode }),
  )
}

write(path.join(iosAssets, 'AppIconPreview/Contents.json'), json({ info: xcode }))

for (const [letter, file] of Object.entries(CHARACTERS)) {
  for (const [number, layout] of Object.entries(LAYOUTS)) {
    const id = letter + number

    const desktopIcon = await macGrid(screenshot(page(file, layout, 0, true), SIZE))

    write(path.join(desktop, `public/app-icons/${id}.png`), desktopIcon)
    // electron-builder makes the .icns (and the Windows and Linux icons) from this file.
    if (id === BUNDLED) write(path.join(desktop, 'build/icon.png'), desktopIcon)
    await writeIos(id, screenshot(page(file, layout, 0, false), SIZE))
    const bled = screenshot(page(file, layout, BLEED, false), SIZE + BLEED * 2)

    const name = `app_icon_${id.toLowerCase()}`

    write(
      path.join(androidRes, `drawable-nodpi/${name}.png`),
      await sharp(bled).resize(432).png().toBuffer(),
    )
    write(
      path.join(androidRes, `mipmap-anydpi/${name}.xml`),
      `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by apps/desktop/scripts/render-app-icons.mjs. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/${name}" />
</adaptive-icon>
`,
    )
    console.log(id)
  }
}

fs.rmSync(tmp, { recursive: true })
