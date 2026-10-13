package ai.nuphos.android.notifications

/** A push carries routing data, never authority to display another account's content. */
object PushBindingPolicy {
    fun accepts(account: String?, boundLogin: String?, currentLogin: String?, messageAccount: String?, foreground: Boolean): Boolean =
        !foreground && !account.isNullOrBlank() && !boundLogin.isNullOrBlank() &&
            boundLogin == currentLogin && account == messageAccount
}
