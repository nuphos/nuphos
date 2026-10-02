/*! logo-intro v0.1.0 · MIT License */
/**
 * A WebGL logo intro in five beats:
 *   1. Mark     the logo mark arrives from an extreme close-up with lens warp, spectral colour fringes and a spin
 *   2. Wordmark the mark slides aside while the letters pull out of it
 *   3. Bloom    a soft mesh-gradient blob grows behind the lockup
 *   4. Lock-in  a badge pops under the mark (or the mark's two parts snap together) and the blob hollows into a ring
 *   5. Shimmer  one iridescent band sweeps across the mark and the letters
 * Every frame is a pure function of t, so scrubbing, playback and frame-by-frame video export all match.
 */

export const DURATION = 5;

/** Beat boundaries in seconds; the demo controls use them for timeline ticks. */
export const TIMELINE = Object.freeze({
  mark: 0.18, wordmark: 1.15, lockIn: 2.6, shimmer: 3.15, hold: 4.05,
});

const TEX = 2048;
const SHINE_DIR = [0.9659, 0.2588]; // 105deg, in logo units (y down)
const DEFAULT_SHIMMER = ['#7c5cff', '#19c3e6', '#ff4fb8'];

const VERT = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
#ifdef HAS_LOD
#extension GL_EXT_shader_texture_lod : enable
#define TEX(s, uv, lod) texture2DLodEXT(s, uv, lod)
#else
#define TEX(s, uv, lod) texture2D(s, uv)
#endif
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;       // canvas size, device px
uniform float uDpr;      // device px per CSS px
uniform float uT;        // timeline seconds
uniform vec4 uMark;      // mark centre x, y (CSS px from stage centre, y up), px per logo unit, opacity
uniform vec4 uMarkF;     // rotation, lens warp, chromatic aberration, zoom blur
uniform vec3 uTexF;      // texture side (logo units), explicit mip level, rotational dispersion
uniform vec4 uOff;       // part 0 and part 1 offsets for the lock-in (logo units, y down)
uniform float uClip;     // 1 when part 1 is clipped by the mark's clip shape (texture blue channel)
uniform vec3 uBlob;      // radius px, opacity, wobble
uniform vec2 uHol;       // hollow amount, hollow radius px
uniform vec3 uBg;
uniform vec3 uInk;
uniform vec3 uBloom[5];
uniform sampler2D uTex;  // r = mark part 0, g = mark part 1, b = clip shape

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 spectrum(float x) {
  return clamp(vec3(abs(x * 6.0 - 3.0) - 1.0, 2.0 - abs(x * 6.0 - 2.0), 2.0 - abs(x * 6.0 - 4.0)), 0.0, 1.0);
}

float markCov(vec2 q, float dRot) {
  vec2 u = q - uMark.xy;
  float a = uMarkF.x + dRot;
  float c = cos(a), s = sin(a);
  u = vec2(c * u.x - s * u.y, s * u.x + c * u.y) / uMark.z;
  u.y = -u.y;
  float pa = TEX(uTex, (u - uOff.xy) / uTexF.x + 0.5, uTexF.y).r;
  float pb = TEX(uTex, (u - uOff.zw) / uTexF.x + 0.5, uTexF.y).g;
  pb *= mix(1.0, TEX(uTex, u / uTexF.x + 0.5, uTexF.y).b, uClip);
  return max(pa, pb);
}

// Lens warp + spectral radial dispersion + zoom blur, jittered per pixel so samples blend instead of stacking.
vec3 markRGB(vec2 q, float hd) {
  vec2 n = q / hd;
  float r2 = dot(n, n);
  vec2 w = q * (1.0 + uMarkF.y * r2);
  float ca = uMarkF.z * (0.35 + r2);
  float j1 = hash(gl_FragCoord.xy);
  float j2 = hash(gl_FragCoord.yx + 17.0);
  vec3 cov = vec3(0.0), wsum = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float x = (float(i) + j1) / 16.0;
    float z = fract(float(i) * 0.618034 + j2);
    vec3 sw = spectrum(x * 0.8);
    float f = (1.0 + uMarkF.w * (z - 0.5)) * (1.0 + ca * (1.0 - 2.0 * x));
    cov += sw * markCov(w * f, uTexF.z * (x - 0.5));
    wsum += sw;
  }
  return cov / wsum;
}

// Mesh gradient: five coloured lights orbiting inside the blob.
void light(vec2 n, float ang, float rad, float s, vec3 col, float w, inout vec3 acc, inout float ws) {
  vec2 d = n - rad * vec2(cos(ang), sin(ang));
  float k = w * exp(-dot(d, d) / (s * s));
  acc += col * k;
  ws += k;
}
vec3 field(vec2 n, float t) {
  vec3 acc = vec3(0.0);
  float ws = 1e-3;
  light(n, 0.7 * t + 0.3, 0.50, 0.80, uBloom[0], 1.25, acc, ws);
  light(n, -0.9 * t + 2.2, 0.55, 0.70, uBloom[1], 1.00, acc, ws);
  light(n, 1.1 * t + 4.0, 0.50, 0.62, uBloom[2], 0.95, acc, ws);
  light(n, -0.6 * t + 5.3, 0.60, 0.55, uBloom[3], 0.80, acc, ws);
  light(n, 0.8 * t + 3.1, 0.70, 0.45, uBloom[4], 0.40, acc, ws);
  return acc / ws;
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * uRes) / uDpr;
  float hd = 0.5 * length(uRes / uDpr);
  float t = uT;
  vec3 col = uBg;

  float R = uBlob.x;
  if (uBlob.y > 0.001) {
    float r = length(q);
    float ang = atan(q.y, q.x);
    float wob = 0.055 * sin(3.0 * ang + 1.7 * t) + 0.035 * sin(5.0 * ang - 2.3 * t + 1.0) + 0.022 * sin(7.0 * ang + 3.1 * t + 2.0);
    float d = r - R * (1.0 + uBlob.z * wob);
    float soft = R * 0.3;
    float body = 1.0 - smoothstep(-soft * 0.9, soft, d);
    body *= mix(1.0, smoothstep(uHol.y - R * 0.35, uHol.y + R * 0.2, r), uHol.x);
    col = mix(col, field(q / R, t), body * uBlob.y);
  }

  if (uMark.w > 0.001) col = mix(col, uInk, markRGB(q, hd) * uMark.w);

  col += (hash(gl_FragCoord.xy + fract(t) * 7.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const STYLE = `
.li-stage{position:absolute;inset:0;overflow:hidden}
.li-overlay{position:fixed;inset:0;z-index:2147483000;cursor:pointer;transition:opacity .45s ease}
.li-overlay.li-leaving{opacity:0;pointer-events:none}
.li-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.li-lockup{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);will-change:transform;pointer-events:none;user-select:none}
.li-lockup>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;display:block}
.li-lockup>.li-ch{will-change:transform,opacity,filter}
.li-defs{position:absolute;width:0;height:0;overflow:hidden}`;

// ---- small helpers ----
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, e) => a + (b - a) * e;
const outCubic = x => 1 - Math.pow(1 - x, 3);
const inOutCubic = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outBack = (x, s = 2.2) => (x <= 0 ? 0 : 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2));
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
};
function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
const mix = (a, b, e) => a.map((v, i) => v + (b[i] - v) * e);
const hex = c => '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = STYLE;
  document.head.append(s);
}
function loadFontCss(url) {
  if (!url || [...document.querySelectorAll('link[rel=stylesheet]')].some(l => l.href === url)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.append(link);
}

/** Bounding box of paths in logo units, measured by the browser (stroke width added for stroked paths). */
function measurePaths(paths) {
  const probe = svgEl('svg', { width: 0, height: 0, style: 'position:absolute;visibility:hidden' });
  document.body.append(probe);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) {
    const el = svgEl('path', { d: p.d });
    probe.append(el);
    const b = el.getBBox(), pad = p.stroke ? p.stroke / 2 : 0;
    x0 = Math.min(x0, b.x - pad); y0 = Math.min(y0, b.y - pad);
    x1 = Math.max(x1, b.x + b.width + pad); y1 = Math.max(y1, b.y + b.height + pad);
  }
  probe.remove();
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * Lays the brand out in one logo coordinate system. Path wordmarks already share the logo's viewBox; text
 * wordmarks are measured with the (loaded) font and set to the right of the mark, caps centred on it.
 */
function buildModel(brand) {
  const mark = brand.mark;
  const markPaths = mark.paths.map(p => ({ part: 0, ...p }));
  const MB = measurePaths(markPaths);
  const wm = brand.wordmark || {};
  let vb, letters, F;
  if (wm.text) {
    const [mx, my, mw, mh] = mark.viewBox;
    const f = wm.font || {};
    const size = wm.fontSize ?? mh / 1.3;
    const gap = wm.gap ?? mh * 0.28;
    const ls = (f.letterSpacing ?? 0) * size;
    const ctx = document.createElement('canvas').getContext('2d');
    const font = `${f.weight ?? 700} 100px ${f.family ? `"${f.family}"` : 'sans-serif'}, sans-serif`;
    ctx.font = font;
    const s = size / 100;
    const cap = (ctx.measureText('H').actualBoundingBoxAscent || 70) * s;
    const whole = ctx.measureText(wm.text);
    const ascent = (whole.actualBoundingBoxAscent || 76) * s, descent = (whole.actualBoundingBoxDescent || 2) * s;
    const baseline = my + mh / 2 + cap / 2 + (wm.baselineShift ?? 0) * size;
    let x = mx + mw + gap;
    letters = Array.from(wm.text, ch => {
      const letter = { ch, x, y: baseline, size, font: f };
      x += ctx.measureText(ch).width * s + ls;
      return letter;
    });
    const right = x - ls;
    const top = Math.min(my, baseline - ascent), bottom = Math.max(my + mh, baseline + descent);
    vb = [mx, top, right - mx, bottom - top];
    F = size;
  } else {
    vb = brand.viewBox;
    letters = (wm.letters || []).map(ds => ({ paths: (Array.isArray(ds) ? ds : [ds]).join(' ') }));
    F = wm.xHeight ?? vb[3] * 0.54;
  }
  // Letter x positions relative to the first letter (for the pull-out offsets).
  let xs = [], markTrails = false;
  if (wm.text) xs = letters.map(l => l.x - letters[0].x);
  else if (letters.length) {
    const bx = letters.map(l => measurePaths([{ d: l.paths }]).x);
    xs = bx.map(x => x - bx[0]);
  }
  const b = mark.badge || null;
  const badgeBox = b && (b.d ? measurePaths([{ d: b.d }]) : { cx: b.x + b.width / 2, cy: b.y + b.height / 2 });
  if (!wm.text && letters.length) {
    const first = measurePaths([{ d: letters[0].paths }]);
    markTrails = MB.cx > first.x + xs[xs.length - 1];
  }
  return { vb, markPaths, MB, badge: b, badgeBox, clip: mark.clip || null, letters, xs, F, markTrails };
}

function createGl(canvas, allowSoftware) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: !allowSoftware });
  if (!gl) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('logo-intro:', gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const hasLod = !!gl.getExtension('EXT_shader_texture_lod');
  const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, (hasLod ? '#define HAS_LOD\n' : '') + FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ['uRes', 'uDpr', 'uT', 'uMark', 'uMarkF', 'uTexF', 'uOff', 'uClip', 'uBlob', 'uHol', 'uBg', 'uInk', 'uBloom', 'uTex']) U[n] = gl.getUniformLocation(prog, n);
  return { gl, U };
}

/** Rasterises the mark into a square texture centred on the mark: part 0 in red, part 1 in green, clip in blue. */
function markTexture(gl, model, side) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TEX, TEX);
  const k = TEX / side;
  ctx.setTransform(k, 0, 0, k, TEX / 2 - model.MB.cx * k, TEX / 2 - model.MB.cy * k);
  ctx.globalCompositeOperation = 'lighter';
  for (const p of model.markPaths) {
    const color = p.part === 1 ? '#0f0' : '#f00';
    const path = new Path2D(p.d);
    if (p.stroke) {
      ctx.strokeStyle = color;
      ctx.lineWidth = p.stroke;
      ctx.lineCap = p.cap || 'butt';
      ctx.lineJoin = p.join || 'miter';
      ctx.stroke(path);
    } else {
      ctx.fillStyle = color;
      ctx.fill(path, p.fillRule || 'nonzero');
    }
  }
  if (model.clip) {
    ctx.fillStyle = '#00f';
    ctx.fill(new Path2D(model.clip));
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/**
 * Mounts the intro into `host` (or a full-screen overlay) and returns a player.
 *
 * options:
 *   autoplay        start as soon as fonts are ready (default true)
 *   loop            restart after the hold (default false)
 *   speed           playback rate (default 1)
 *   overlay         cover the page with a fixed layer instead of filling `host` (default false)
 *   exitAt          seconds; fade out and remove at this time (e.g. 4.35 for a site splash)
 *   skippable       any click, key, wheel or touch fades it out (default false)
 *   scale           lockup size multiplier (default 1)
 *   maxDpr          device pixel ratio cap for the canvas (default 2)
 *   allowSoftwareGL render even on software WebGL, e.g. for video export (default false)
 *   reducedMotion   'final' shows the last frame, 'skip' removes it at once, 'ignore' plays (default 'final')
 *   onTick(t), onFinish()
 */
export function mountLogoIntro(host, brand, options = {}) {
  const o = {
    autoplay: true, loop: false, speed: 1, overlay: false, exitAt: null, skippable: false, scale: 1,
    maxDpr: 2, allowSoftwareGL: false, reducedMotion: 'final', onTick: null, onFinish: null, ...options,
  };
  injectStyle();
  const theme = brand.theme || {};
  const uid = `li${Math.random().toString(36).slice(2, 8)}`;

  const stage = document.createElement('div');
  stage.className = o.overlay ? 'li-stage li-overlay' : 'li-stage';
  stage.style.background = theme.background || '#fbfbf9';
  if (o.overlay) stage.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'li-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const lockup = document.createElement('div');
  lockup.className = 'li-lockup';
  if (!o.overlay) { lockup.setAttribute('role', 'img'); lockup.setAttribute('aria-label', brand.name || 'Logo'); }
  stage.append(canvas, lockup);
  (o.overlay ? document.body : host).append(stage);

  const ctx = createGl(canvas, o.allowSoftwareGL);
  const listeners = new AbortController();
  let model, geo, els, raf = 0, t = 0, playing = false, startWall = 0, speed = o.speed, frames = 0, dprCap = o.maxDpr;
  let destroyed = false, leaving = false, resolveReady, resolveFinished;
  const ready = new Promise(r => { resolveReady = r; });
  const finished = new Promise(r => { resolveFinished = r; });
  const ink = theme.ink || '#15181a';
  const shimmer = theme.shimmer || DEFAULT_SHIMMER;
  const lockIn = brand.lockIn || { type: brand.mark?.badge ? 'badge' : 'pulse' };
  const dir = (() => { const d = lockIn.direction || [Math.SQRT1_2, Math.SQRT1_2], l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; })();
  const sepDist = lockIn.type === 'assemble' || lockIn.type === 'rise' ? (lockIn.distance ?? 24) : 0;
  // Lock-in normally lands after the wordmark (2.6 s). An earlier `lockIn.at` plays it on the landed mark first,
  // and the wordmark waits until it has finished.
  const lockAt = lockIn.at ?? 2.6;
  const lockDur = lockIn.type === 'rise' ? 0.55 : 0.45;
  const wordAt = lockAt < 2 ? Math.max(1.15, lockAt + lockDur + 0.05) : 1.15;
  const beats = { mark: 0.18, wordmark: wordAt, lockIn: lockAt, shimmer: 3.15, hold: 4.05 };

  // ---- DOM lockup: badge, mark and one SVG per letter, all painted by a shared shimmer gradient ----
  function buildDom() {
    const [vx, vy, vw, vh] = model.vb;
    const viewBox = `${vx} ${vy} ${vw} ${vh}`;
    const defs = svgEl('svg', { class: 'li-defs', 'aria-hidden': 'true' });
    const a = (1.3 - 0.55) / 2.6;
    const inkStops = [[0, ink], [a, shimmer[0]], [0.5, shimmer[1]], [1 - a, shimmer[2]], [1, ink]];
    const tint = shimmer.map(c => hex(mix(rgb(c), [1, 1, 1], 0.5)));
    const badgeStops = [[0, tint[0], 0], [a, tint[0], 0.55], [0.5, tint[1], 0.55], [1 - a, tint[2], 0.55], [1, tint[2], 0]];
    const grad = (id, stops) => {
      const g = svgEl('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: -1e5, y1: 0, x2: -1e5 + 1, y2: 0 });
      for (const [off, color, op] of stops) g.append(svgEl('stop', { offset: off, 'stop-color': color, 'stop-opacity': op ?? 1 }));
      return g;
    };
    const shine = grad(`${uid}-shine`, inkStops), shineBadge = grad(`${uid}-badge`, badgeStops);
    const d = svgEl('defs');
    d.append(shine, shineBadge);
    defs.append(d);
    stage.append(defs);
    const paint = `url(#${uid}-shine)`;

    const layer = cls => { const s = svgEl('svg', { viewBox, class: cls, 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' }); lockup.append(s); return s; };
    let badgeSvg = null;
    if (model.badge) {
      const b = model.badge;
      badgeSvg = layer('li-badge');
      // A badge is a rounded rectangle or any path (`d`); a second copy carries the shimmer tint.
      const [tag, shape] = b.d ? ['path', { d: b.d }] : ['rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: b.radius ?? 0 }];
      badgeSvg.append(svgEl(tag, { ...shape, fill: b.color || '#c6f23a' }), svgEl(tag, { ...shape, fill: `url(#${uid}-badge)` }));
    }
    const markSvg = layer('li-mark');
    const parts = [svgEl('g'), svgEl('g')];
    if (model.clip) {
      const cp = svgEl('clipPath', { id: `${uid}-clip` });
      cp.append(svgEl('path', { d: model.clip }));
      d.append(cp);
      const clipped = svgEl('g', { 'clip-path': `url(#${uid}-clip)` });
      clipped.append(parts[1]);
      markSvg.append(parts[0], clipped);
    } else markSvg.append(...parts);
    // Paths in the ink colour take the shimmer as their paint; coloured paths keep their colour under a tinted overlay.
    const shapeAttrs = (p, paintWith) => (p.stroke
      ? { d: p.d, fill: 'none', stroke: paintWith, 'stroke-width': p.stroke, 'stroke-linecap': p.cap || 'butt', 'stroke-linejoin': p.join || 'miter' }
      : { d: p.d, fill: paintWith, 'fill-rule': p.fillRule || 'nonzero' });
    model.markPaths.forEach((p, i) => {
      const group = parts[p.part === 1 ? 1 : 0];
      let own = p.color;
      if (p.gradient) {
        // A linear gradient in logo units: { from: [x, y], to: [x, y], stops: [[offset, colour], ...] }.
        const g = p.gradient, id = `${uid}-g${i}`;
        const lg = svgEl('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: g.from[0], y1: g.from[1], x2: g.to[0], y2: g.to[1] });
        for (const [off, color] of g.stops) lg.append(svgEl('stop', { offset: off, 'stop-color': color }));
        d.append(lg);
        own = `url(#${id})`;
      }
      if (own) group.append(svgEl('path', shapeAttrs(p, own)), svgEl('path', shapeAttrs(p, `url(#${uid}-badge)`)));
      else group.append(svgEl('path', shapeAttrs(p, paint)));
    });
    const letterSvgs = model.letters.map(l => {
      const s = layer('li-ch');
      if (l.ch != null) {
        const tx = svgEl('text', { x: l.x, y: l.y, fill: paint, 'font-size': l.size, 'font-weight': l.font.weight ?? 700, 'font-family': l.font.family ? `${l.font.family}, sans-serif` : 'sans-serif' });
        tx.textContent = l.ch;
        s.append(tx);
      } else s.append(svgEl('path', { d: l.paths, fill: paint }));
      return s;
    });
    return { defs, shine, shineBadge, badgeSvg, markSvg, parts, letterSvgs };
  }

  // ---- Layout: size the lockup to the stage and derive the mark's resting position ----
  function layout() {
    const r = stage.getBoundingClientRect();
    const W = Math.max(1, r.width), H = Math.max(1, r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const [vx, vy, vw, vh] = model.vb;
    // Width follows the screen; long wordmarks grow further so the mark keeps a readable height.
    const base = Math.max(W < 700 ? W * 0.56 : W * 0.26, H * 0.075 * vw / vh) * o.scale * (brand.scale ?? 1);
    const L = Math.max(120, Math.min(base, 480 * o.scale * (brand.scale ?? 1), W - 64, H * 0.2 * vw / vh));
    const k = L / vw;
    lockup.style.width = `${L}px`;
    lockup.style.height = `${vh * k}px`;
    const origin = (x, y) => `${((x - vx) / vw * 100).toFixed(3)}% ${((y - vy) / vh * 100).toFixed(3)}%`;
    els.markSvg.style.transformOrigin = origin(model.MB.cx, model.MB.cy);
    if (els.badgeSvg) els.badgeSvg.style.transformOrigin = origin(model.badgeBox.cx, model.badgeBox.cy);
    // Shimmer sweep range: projections of the lockup corners onto the sweep direction.
    const corners = [[vx, vy], [vx + vw, vy], [vx, vy + vh], [vx + vw, vy + vh]].map(([x, y]) => x * SHINE_DIR[0] + y * SHINE_DIR[1]);
    geo = {
      W, H, dpr: canvas.width / W, k,
      markX: (model.MB.cx - (vx + vw / 2)) * k, markY: (model.MB.cy - (vy + vh / 2)) * k,
      pMin: Math.min(...corners), pMax: Math.max(...corners),
      side: Math.max(model.MB.w, model.MB.h) * 1.4 + 2 * sepDist,
    };
  }

  function frame(time) {
    t = time;
    const { W, H, k } = geo;
    const diag = Math.hypot(W, H), minD = Math.min(W, H), F = model.F;
    const markSize = Math.max(model.MB.w, model.MB.h);

    // 1. Mark: extreme close-up, lens-warped and colour-split, spinning back to its resting size.
    const K0 = diag * (brand.closeUp ?? 1.2) / markSize, K1 = k;
    const logK = tt => lerp(Math.log(K0), Math.log(K1), inOutCubic(seg(tt, 0.18, 1.05)));
    const scale = Math.exp(logK(t));
    const vel = Math.abs(logK(t + 0.008) - logK(t - 0.008)) / 0.016;
    const zb = Math.min(0.12, vel * 0.016);
    const rotAt = tt => -1.2 * (1 - outCubic(seg(tt, 0.18, 1.25)));
    const rot = rotAt(t);
    const rca = Math.min(0.14, Math.abs(rotAt(t + 0.008) - rotAt(t - 0.008)) / 0.016 * 0.045);
    const warp = -0.45 * (1 - outCubic(seg(t, 0.18, 0.9)));
    const ca = Math.min(0.06, vel * 0.008) + 0.03 * (1 - outCubic(seg(t, 0.18, 1.0)));
    // Once landed, the shader mark hands over to the crisp SVG mark.
    const handoff = ctx ? seg(t, 1.06, 1.16) : 1;
    const markA = seg(t, 0.18, 0.3) * (1 - handoff);
    els.markSvg.style.opacity = handoff.toFixed(3);

    // 2. Wordmark: the mark slides aside while the letters pull out of it.
    const slide = inOutCubic(seg(t, wordAt, wordAt + 0.7));
    const mx = geo.markX * slide;
    lockup.style.transform = `translate(-50%, -50%) translateX(${(mx - geo.markX).toFixed(2)}px)`;
    // Letters pull out of the mark: rightwards when the mark leads, leftwards when it trails the wordmark.
    const n = els.letterSvgs.length, span = model.xs[n - 1] || 0;
    els.letterSvgs.forEach((s, i) => {
      const j = model.markTrails ? n - 1 - i : i;
      const reach = model.markTrails ? span - model.xs[i] : model.xs[i];
      const a = wordAt + 0.12 + j * 0.045;
      const e = outCubic(seg(t, a, a + 0.6));
      s.style.transform = `translateX(${((model.markTrails ? 1 : -1) * (reach * k + 0.5 * F * k) * 0.45 * (1 - e)).toFixed(2)}px)`;
      s.style.opacity = seg(t, a, a + 0.32).toFixed(3);
      s.style.filter = e < 0.995 ? `blur(${((1 - e) * 6).toFixed(2)}px)` : 'none';
    });

    // 3. Bloom.
    const blobA = (theme.bloomOpacity ?? 0.88) * outCubic(seg(t, 0.85, 1.45)) * (1 - inOutCubic(seg(t, 3.0, 3.9)));
    const R = minD * (0.06 + 0.1 * outCubic(seg(t, 0.85, 1.45)) + 0.16 * inOutCubic(seg(t, 1.4, 2.8)) + 0.5 * outCubic(seg(t, 2.65, 3.9)));
    const wob = inOutCubic(seg(t, 0.9, 1.9));

    // 4. Lock-in: badge pops (or the parts snap together), the mark pulses, the blob hollows into a ring.
    const lock = seg(t, lockAt, lockAt + lockDur);
    if (els.badgeSvg) {
      els.badgeSvg.style.transform = `scale(${outBack(lock).toFixed(4)})`;
      els.badgeSvg.style.opacity = seg(t, lockAt, lockAt + 0.07).toFixed(3);
    }
    const rise = lockIn.type === 'rise';
    const sep = sepDist * (1 - (rise ? outBack(lock, 1.2) : outBack(lock)));
    const px = dir[0] * sep, py = dir[1] * sep;
    // assemble: the parts sit on opposite sides and meet; rise: part 1 travels in from `direction` while part 0 stays.
    const off = rise ? [0, 0, px, py] : [-px, -py, px, py];
    els.parts[0].setAttribute('transform', `translate(${off[0].toFixed(3)} ${off[1].toFixed(3)})`);
    els.parts[1].setAttribute('transform', `translate(${off[2].toFixed(3)} ${off[3].toFixed(3)})`);
    // spin: the mark starts turned by `angle` (invisible for a symmetric mark) and snaps round at the lock-in.
    const spin = lockIn.type === 'spin' ? -(lockIn.angle ?? 120) * (1 - outBack(lock, 1.6)) : 0;
    els.markSvg.style.transform = `scale(${(1 - 0.07 * Math.sin(Math.PI * seg(t, lockAt, lockAt + 0.3))).toFixed(4)}) rotate(${spin.toFixed(2)}deg)`;
    const hollowAmt = inOutCubic(seg(t, 2.65, 3.15));
    const hollowR = R * (0.25 + 0.5 * outCubic(seg(t, 2.65, 3.7)));

    // 5. Shimmer: one band sweeps across the whole lockup.
    const sh = seg(t, 3.15, 4.05);
    const band = 1.3 * F;
    const sp = sh > 0 && sh < 1 ? lerp(geo.pMin - band, geo.pMax + band, 0.5 - 0.5 * Math.cos(Math.PI * sh)) : -1e5;
    for (const g of [els.shine, els.shineBadge]) {
      g.setAttribute('x1', (SHINE_DIR[0] * (sp - band)).toFixed(2));
      g.setAttribute('y1', (SHINE_DIR[1] * (sp - band)).toFixed(2));
      g.setAttribute('x2', (SHINE_DIR[0] * (sp + band)).toFixed(2));
      g.setAttribute('y2', (SHINE_DIR[1] * (sp + band)).toFixed(2));
    }

    o.onTick?.(t);
    if (!ctx) return;
    const { gl, U } = ctx;
    const lod = Math.log2(Math.max(1e-4, TEX / (geo.side * scale))) + Math.min(2, ca * 25 + zb * 6);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uDpr, geo.dpr);
    gl.uniform1f(U.uT, t);
    gl.uniform4f(U.uMark, mx, -geo.markY, scale, markA);
    gl.uniform4f(U.uMarkF, rot, warp, ca, zb);
    gl.uniform3f(U.uTexF, geo.side, Math.max(0, lod), rca);
    gl.uniform4f(U.uOff, off[0], off[1], off[2], off[3]);
    gl.uniform3f(U.uBlob, R, blobA, wob);
    gl.uniform2f(U.uHol, hollowAmt, hollowR);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- Playback: wall-clock time, so a slow device drops frames but keeps the timing ----
  const end = () => (o.exitAt != null ? o.exitAt : DURATION);
  function tick(now) {
    raf = 0;
    if (!playing || destroyed) return;
    let time = (now - startWall) / 1000 * speed;
    if (time >= end() && o.exitAt == null) {
      if (o.loop) { startWall = now; time = 0; } else { frame(DURATION); pause(); finish(); return; }
    }
    frame(Math.min(time, DURATION));
    if (++frames === 12 && dprCap > 1 && (now - startWall) / 11 > 45) { dprCap = 1; layout(); }
    if (o.exitAt != null && time >= o.exitAt) leave(450);
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (destroyed || !model) return;
    if (t >= DURATION) t = 0;
    playing = true;
    startWall = performance.now() - t * 1000 / speed;
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function pause() { playing = false; }
  function seek(time) {
    pause();
    if (model) frame(Math.max(0, Math.min(DURATION, time)));
  }
  function setSpeed(s) {
    speed = s;
    if (playing) startWall = performance.now() - t * 1000 / speed;
  }
  function finish() { if (!leaving) o.onFinish?.(); resolveFinished(); }
  function leave(ms) {
    if (leaving || destroyed) return;
    leaving = true;
    stage.style.transitionDuration = `${ms}ms`;
    stage.classList.add('li-leaving');
    setTimeout(() => { o.onFinish?.(); destroy(); resolveFinished(); }, ms + 40);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    playing = false;
    cancelAnimationFrame(raf);
    listeners.abort();
    resize?.disconnect();
    ctx?.gl.getExtension('WEBGL_lose_context')?.loseContext();
    stage.remove();
  }

  if (o.skippable) {
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(type, () => leave(260), { signal: listeners.signal, passive: true, capture: true });
    }
  }
  if (o.overlay) document.addEventListener('visibilitychange', () => { if (document.hidden) leave(0); }, { signal: listeners.signal });
  let resize = null;

  // ---- Boot: fonts first (text wordmarks are measured), then geometry, texture and the first frame ----
  (async () => {
    const f = brand.wordmark?.font;
    loadFontCss(f?.css);
    if (f?.family && document.fonts) {
      await Promise.race([document.fonts.load(`${f.weight ?? 700} 48px "${f.family}"`).catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
    }
    if (destroyed) return;
    model = buildModel(brand);
    els = buildDom();
    layout();
    if (ctx) {
      const { gl, U } = ctx;
      markTexture(gl, model, geo.side);
      gl.uniform1i(U.uTex, 0);
      gl.uniform3fv(U.uBg, rgb(theme.background || '#fbfbf9'));
      gl.uniform3fv(U.uInk, rgb(theme.markInk || ink));
      gl.uniform1f(U.uClip, model.clip ? 1 : 0);
      const bloom = theme.bloom || ['#c6f23a', '#66f1bc', '#4ae0f3', '#f1f36f', '#d6a8f7'];
      gl.uniform3fv(U.uBloom, new Float32Array(bloom.flatMap(rgb)));
    } else {
      stage.dataset.noGl = '';
    }
    resize = new ResizeObserver(() => { if (!destroyed) { layout(); frame(t); } });
    resize.observe(stage);
    const reduced = o.reducedMotion !== 'ignore' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    frame(reduced ? DURATION : 0);
    resolveReady();
    if (reduced) { if (o.reducedMotion === 'skip' || o.exitAt != null) leave(0); return; }
    if (o.autoplay) play();
  })();

  return {
    get time() { return t; },
    get playing() { return playing; },
    duration: DURATION,
    timeline: beats,
    ready, finished, play, pause, seek, setSpeed,
    replay() { t = 0; play(); },
    skip() { leave(260); },
    destroy,
    set loop(v) { o.loop = v; },
    get loop() { return o.loop; },
  };
}
