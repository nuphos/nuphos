// Captures frames of the live nuphos.ai hero shader (WebGPU) with the page content hidden.
// `node hero.mjs ipad` captures them at the iPad 13" screenshot size instead.
import { chromium } from 'playwright-core';
const [W, H, NAME] = process.argv[2] === 'ipad' ? [2064, 2752, 'hero-ipad'] : [1320, 2868, 'hero'];
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await p.goto('https://nuphos.ai', { waitUntil: 'networkidle', timeout: 60000 });
await p.evaluate((h) => {
  const sec = document.querySelector('#product');
  // These selectors belong to the landing page; fail loudly when it changes.
  if (!sec?.querySelector(':scope > .z-10')) throw new Error('nuphos.ai hero markup changed: update hero.mjs');
  sec.style.minHeight = sec.style.height = `${h}px`;
  sec.querySelector(':scope > .z-10').style.display = 'none';
  document.querySelectorAll('main > :not(#product), header, nav').forEach((e) => (e.style.display = 'none'));
}, H);
for (const t of [2, 5, 8, 11, 14, 17]) { await p.waitForTimeout(3000); await p.screenshot({ path: `build/${NAME}-${t}.png` }); }
await b.close();
