package ai.nuphos.android.notifications

/** A push carries routing data, never authority to display another account's content. */
object PushBindingPolicy {
    fun accepts(account: String?, boundLogin: String?, currentLogin: String?, messageAccount: String?, readingConversation: Boolean): Boolean =
        !readingConversation && !account.isNullOrBlank() && !boundLogin.isNullOrBlank() &&
            boundLogin == currentLogin && account == messageAccount
    fun isReading(foreground: Boolean, visible: LocalNotificationTarget?, incoming: LocalNotificationTarget): Boolean =
        foreground && visible == incoming
}
