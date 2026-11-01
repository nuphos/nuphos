// The document an HTML artifact runs as. The frame is sandboxed without
// allow-same-origin, so the page gets an opaque origin: no app storage, no
// cookies, no reach into the window around it. What we add runs first: links
// leave for the user's browser instead of replacing the frame, in-page anchors
// still move the page's hash, and script errors are reported so the agent can be
// asked to fix them.

export const ARTIFACT_FRAME_SANDBOX = 'allow-scripts allow-popups allow-forms allow-modals'
/** A card's thumbnail runs the page so it draws, but nothing it does can reach the user. */
export const ARTIFACT_THUMBNAIL_SANDBOX = 'allow-scripts'

export type ArtifactFrameMessage = {
  channel: string
  type: 'error' | 'escape' | 'click' | 'arrow'
  message: string
}

/** What the page reports about a click, so a prototype around it can follow a link. */
export type ArtifactClick = {
  /** The `data-goto` of the clicked element or its ancestor. */
  goto: string | null
  /** The visible text of what was clicked. */
  text: string
  /** It is a link, a button, or something styled to be pressed. */
  clickable: boolean
  /** The page marks its own hotspots with `data-goto`, so nothing should be guessed. */
  declared: boolean
}

function bootstrap(channel: string): string {
  // Kept ES5 and self-contained: it runs before any of the artifact's own code.
  const script = `(function(){
var channel=${JSON.stringify(channel)};
function send(message){try{parent.postMessage({nuphosArtifact:channel,type:'error',message:String(message).slice(0,2000)},'*')}catch(e){}}
window.addEventListener('error',function(event){
var target=event.target;
if(target&&target!==window&&(target.tagName==='SCRIPT'||target.tagName==='LINK')){send('Could not load '+(target.src||target.href));return}
if(event.message)send(event.message+(event.lineno?' (line '+event.lineno+')':''))
},true);
window.addEventListener('unhandledrejection',function(event){var reason=event.reason;send('Unhandled rejection: '+(reason&&reason.message?reason.message:reason))});
window.addEventListener('keydown',function(event){if(event.key==='Escape'){try{parent.postMessage({nuphosArtifact:channel,type:'escape',message:''},'*')}catch(e){}}},true);
window.addEventListener('keydown',function(event){
if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'))return;
var t=event.target;if(t&&t.closest&&t.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])'))return;
try{parent.postMessage({nuphosArtifact:channel,type:'arrow',message:event.key==='ArrowLeft'?'left':'right'},'*')}catch(e){}
});
document.addEventListener('click',function(event){
var link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
if(!link)return;var href=link.getAttribute('href')||'';
if(href.charAt(0)==='#'){event.preventDefault();try{location.hash=href}catch(e){var el=document.getElementById(decodeURIComponent(href.slice(1)));if(el)el.scrollIntoView()}}
else if(/^javascript:/i.test(href)){event.preventDefault()}
},true);
document.addEventListener('click',function(event){
var t=event.target;if(!t||!t.closest)return;
var go=t.closest('[data-goto]');var c=go||t.closest('a,button,[role=button],[onclick],input,select,label,summary');
if(!c){for(var n=t,i=0;n&&n.nodeType===1&&i<8;i++,n=n.parentElement){if(getComputedStyle(n).cursor==='pointer'){c=n;break}}}
var el=c||t;var text=(el.innerText||el.value||el.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,200);
try{parent.postMessage({nuphosArtifact:channel,type:'click',message:JSON.stringify({goto:go?go.getAttribute('data-goto'):null,text:text,clickable:!!c,declared:!!document.querySelector('[data-goto]')})},'*')}catch(e){}
},true);
})();`

  return `<base target="_blank"><script>${script}</script>`
}

// A viewport when the page brought none, and defaults that keep media inside a
// narrow pane or a phone screen. :where() gives them no specificity, so the
// artifact's rules win. The downloaded file (artifactExport.ts) gets them too.
const VIEWPORT =
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
const RESPONSIVE_DEFAULTS =
  '<style>:where(html){-webkit-text-size-adjust:100%;text-size-adjust:100%}' +
  ':where(img,video,canvas){max-width:100%;height:auto}' +
  ':where(svg,iframe,embed,object,table){max-width:100%}:where(pre){overflow-x:auto}</style>'
const HAS_VIEWPORT = /<meta\b[^>]*\bname\s*=\s*["']?viewport\b/i

// Only what may come before a document's content: blanks, comments, the
// doctype and the opening <html> and <head> tags. A "<head>" further in (in a
// comment, a script string) is the page's text, not its head.
const GAP = '(?:\\s|<!--[\\s\\S]*?-->)*'
const PROLOGUE = new RegExp(
  `^${GAP}(<!doctype[^>]*>)?${GAP}(<html(?:\\s[^>]*)?>)?${GAP}(<head(?:\\s[^>]*)?>)?`,
  'i',
)

/**
 * The artifact's markup with `head` ahead of everything it loads, after a
 * charset, a viewport if it brought none, and the responsive defaults.
 */
export function withArtifactHead(html: string, head: string): string {
  const viewport = HAS_VIEWPORT.test(html) ? '' : VIEWPORT
  const boot = `<meta charset="utf-8">${viewport}${RESPONSIVE_DEFAULTS}${head}`
  const prologue = PROLOGUE.exec(html)
  const [opening = '', doctype, openHtml, openHead] = prologue ?? []
  const rest = html.slice(opening.length)

  if (openHead) return `${opening}${boot}${rest}`
  if (openHtml || doctype) return `${opening}<head>${boot}</head>${rest}`

  // A fragment: give it a document, so it renders in standards mode.
  return `<!doctype html><html><head>${boot}</head><body>${html}</body></html>`
}

/** The artifact's markup with the bootstrap ahead of everything it loads. */
export function artifactSrcDoc(html: string, channel: string): string {
  return withArtifactHead(html, bootstrap(channel))
}

export function readArtifactFrameMessage(
  data: unknown,
  channel: string,
): ArtifactFrameMessage | null {
  if (!data || typeof data !== 'object') return null
  const { nuphosArtifact, type, message } = data as Record<string, unknown>

  if (nuphosArtifact !== channel || typeof message !== 'string') return null
  if (type !== 'error' && type !== 'escape' && type !== 'click' && type !== 'arrow') return null

  return { channel, type, message }
}

/** An SVG artifact as an image URL: an <img> never runs the markup's scripts. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** A click report from the page, or null when it is not one we can read. */
export function parseArtifactClick(message: string): ArtifactClick | null {
  try {
    const value = JSON.parse(message) as Record<string, unknown>

    return {
      goto: typeof value.goto === 'string' && value.goto ? value.goto : null,
      text: typeof value.text === 'string' ? value.text : '',
      clickable: value.clickable === true,
      declared: value.declared === true,
    }
  } catch {
    return null
  }
}
