// noVNC 1.7 exports only its ESM entry; its community types describe the same
// class under the older `lib/rfb` path.
declare module '@novnc/novnc' {
  export { default } from '@novnc/novnc/lib/rfb'
}
