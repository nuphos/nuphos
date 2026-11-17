package ai.nuphos.android.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import ai.nuphos.android.MainActivity
import ai.nuphos.android.R

/** Local-only display adapter. No provider SDK, remote registration or message sender. */
class LocalNotifications(
    private val context: Context,
    private val account: () -> String?,
    private val aiAllowed: () -> Boolean,
) {
    val pending = PendingLocalNotification()
    private var previousAccount: String? = null
    private val manager get() = context.getSystemService(NotificationManager::class.java)

    fun onIdentity(current: String?, signedOut: Boolean) {
        if (signedOut || (previousAccount != null && previousAccount != current)) clear()
        previousAccount = current
    }

    fun updateBadge(count: Int) {
        if (count == 0) { clear(clearPending = false); return }
        manager.activeNotifications.filter { it.tag == TAG }.forEach {
            manager.notify(TAG, it.id, android.app.Notification.Builder.recoverBuilder(context, it.notification).setNumber(count).setOnlyAlertOnce(true).build())
        }
    }

    fun dismiss(target: LocalNotificationTarget) { manager.cancel(TAG, target.hashCode()) }

    fun clear(clearPending: Boolean = true) {
        if (clearPending) pending.clear()
        manager.activeNotifications.filter { it.tag == TAG }.forEach { manager.cancel(TAG, it.id) }
    }

    fun accept(intent: Intent): Boolean {
        if (intent.action != ACTION) return false
        val target = runCatching {
            LocalNotificationTarget.from(intent.getStringExtra(ACCOUNT), intent.getStringExtra(TEAM), intent.getStringExtra(SESSION))
        }.getOrNull()
        if (target != null) pending.offer(target) else pending.clear()
        return true
    }

    fun post(target: LocalNotificationTarget, title: String = "Nuphos", body: String? = null, badge: Int? = null,
             sender: NotificationSender? = null): Boolean {
        if (LocalNotificationTarget.from(target.accountId, target.teamId, target.sessionId) != target ||
            account() != target.accountId || !aiAllowed() ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED ||
            !manager.areNotificationsEnabled()) return false
        manager.createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.shell_notification_channel), NotificationManager.IMPORTANCE_DEFAULT))
        if (manager.getNotificationChannel(CHANNEL).importance == NotificationManager.IMPORTANCE_NONE) return false
        val intent = Intent(context, MainActivity::class.java).setAction(ACTION)
            .setData(Uri.Builder().scheme("nuphos-local").authority("conversation")
                .appendPath(target.accountId).appendPath(target.teamId).appendPath(target.sessionId).build())
            .putExtra(ACCOUNT, target.accountId).putExtra(TEAM, target.teamId).putExtra(SESSION, target.sessionId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // Mutable so the system can fill in the typed text; the explicit receiver keeps it private.
        val replyIntent = Intent(context, NotificationReplyReceiver::class.java).setData(intent.data)
            .putExtra(ACCOUNT, target.accountId).putExtra(TEAM, target.teamId).putExtra(SESSION, target.sessionId)
        val reply = NotificationCompat.Action.Builder(R.drawable.ic_notification, context.getString(R.string.shell_notification_reply),
            PendingIntent.getBroadcast(context, 0, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
            .addRemoteInput(RemoteInput.Builder(REPLY).setLabel(context.getString(R.string.shell_notification_message)).build())
            // Unlocking first: a reply can start agent work on the team's accounts.
            .setAuthenticationRequired(true)
            .build()
        val text = body ?: context.getString(R.string.shell_notification_open_history)
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setNumber(badge ?: 0).setContentIntent(tap).setAutoCancel(true).addAction(reply)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        // A Bot speaks with its own face, as on iOS; without one it stays a plain Nuphos notification.
        val face = sender?.let { NotificationAvatars.bitmap(context, it.avatarFile) }
        if (sender != null && face != null) {
            val bot = Person.Builder().setName(sender.name).setIcon(IconCompat.createWithBitmap(face)).setKey(target.sessionId).build()
            val you = Person.Builder().setName(context.getString(R.string.shell_notification_you)).build()
            builder.setLargeIcon(face).setStyle(NotificationCompat.MessagingStyle(you).addMessage(text, System.currentTimeMillis(), bot))
        }
        manager.notify(TAG, target.hashCode(), builder.build())
        return true
    }

    companion object {
        const val CHANNEL = "conversation_updates"
        const val TAG = "nuphos-local"
        const val ACTION = "ai.nuphos.android.LOCAL_NOTIFICATION"
        const val ACCOUNT = "notification_account"
        const val TEAM = "notification_team"
        const val SESSION = "notification_session"
        const val REPLY = "notification_reply"
    }
}
