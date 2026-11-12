import { ipcRenderer } from 'electron'

export const voiceApi = {
  voiceTranscribe: (
    teamId: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
    prompt?: string,
  ) => ipcRenderer.invoke('voice:transcribe', teamId, file, prompt),
}
