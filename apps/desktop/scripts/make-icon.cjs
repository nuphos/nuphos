const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const root = path.resolve(__dirname, '..')
const iconsetDir = path.join(root, 'build/icon.iconset')
fs.mkdirSync(iconsetDir, { recursive: true })

const SIZE = 1024
const RADIUS = 185
const BG = '#FFFFFF'
const INSET_PCT = 0

const logoSvg = fs.readFileSync(path.join(root, 'public/logo-white-bg.svg'), 'utf8')
fs.writeFileSync(path.join(root, 'public/logo.svg'), logoSvg)
fs.writeFileSync(path.join(root, 'public/favicon.svg'), logoSvg)

function squircleSvg(size, radius, color) {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${color}"/>
     </svg>`,
  )
}

async function renderMaster() {
  const inset = Math.round(SIZE * INSET_PCT)
  const inner = SIZE - inset * 2
  const logoPng = await sharp(Buffer.from(logoSvg), { density: 2048 })
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  return sharp(squircleSvg(SIZE, RADIUS, BG))
    .composite([{ input: logoPng, top: inset, left: inset }])
    .png()
    .toBuffer()
}

async function main() {
  const master = await renderMaster()
  const sizes = [16, 32, 64, 128, 256, 512, 1024]

  for (const s of sizes) {
    await sharp(master)
      .resize(s, s, { fit: 'contain' })
      .png()
      .toFile(path.join(iconsetDir, `icon_${s}x${s}.png`))
    if (s <= 512) {
      await sharp(master)
        .resize(s * 2, s * 2, { fit: 'contain' })
        .png()
        .toFile(path.join(iconsetDir, `icon_${s}x${s}@2x.png`))
    }
  }

  await sharp(master).resize(1024, 1024).png().toFile(path.join(root, 'build/icon.png'))

  console.log('Icons regenerated')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
