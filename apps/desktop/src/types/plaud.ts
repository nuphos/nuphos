export type PlaudAccount = {
  id: string
  label: string
  userName: string | null
  userEmail: string | null
  createdAt?: string
}

export type PlaudBindResult = {
  bindingId: string
  teamId: string
  accountName: string
}
