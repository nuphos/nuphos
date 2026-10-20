import { ipcRenderer } from 'electron'

export const k8sInsightApi = {
  getResourceDiagnosis: (ctx: string, kind: string, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:getResourceDiagnosis', ctx, kind, ns, name),
}
