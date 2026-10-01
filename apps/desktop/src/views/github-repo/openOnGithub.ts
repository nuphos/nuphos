import { api } from '../../api'
import { toast } from '../../components/ui/toast'

export function openOnGithub(url: string) {
  void api.appOpenExternal(url).catch(() => {
    toast.error('Failed to open GitHub')
  })
}
