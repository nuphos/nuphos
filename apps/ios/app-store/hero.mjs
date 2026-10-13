// Captures frames of the live nuphos.ai hero shader (WebGPU) with the page content hidden.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: 1 });
await p.goto('https://nuphos.ai', { waitUntil: 'networkidle', timeout: 60000 });
await p.evaluate(() => {
  const sec = document.querySelector('#product');
  // These selectors belong to the landing page; fail loudly when it changes.
  if (!sec?.querySelector(':scope > .z-10')) throw new Error('nuphos.ai hero markup changed: update hero.mjs');
  sec.style.minHeight = sec.style.height = '2868px';
  sec.querySelector(':scope > .z-10').style.display = 'none';
  document.querySelectorAll('main > :not(#product), header, nav').forEach((e) => (e.style.display = 'none'));
});
for (const t of [2, 5, 8, 11, 14, 17]) { await p.waitForTimeout(3000); await p.screenshot({ path: `build/hero-${t}.png` }); }
await b.close();
