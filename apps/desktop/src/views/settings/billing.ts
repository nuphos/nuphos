import { api } from '../../api'
import { toast } from '../../components/ui/toast'

/** Opens Checkout for a `vcpus` plan, or the portal without one. */
export async function openBilling(teamId: string, vcpus?: number) {
  try {
    await api.appOpenExternal((await api.boxBillingPage(teamId, vcpus)).url)
  } catch (error) {
    toast.apiError('Could not open billing', error)
  }
}
