// Electron-main file transfer. All S3 traffic happens here in the
// Node main process — never the renderer — so there is no CORS surface and we
// can read local file bytes / write downloads to disk. The backend only ever
// hands us short-lived presigned URLs; bytes flow main-process ⇄ S3 directly.

export { downloadAllAsZip, downloadOne, resolveDownloads } from './fileTransfer/download'
export { uploadFiles } from './fileTransfer/upload'
