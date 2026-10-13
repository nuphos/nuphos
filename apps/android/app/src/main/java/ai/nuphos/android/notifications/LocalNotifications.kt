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

    fun clear() {
        pending.clear()
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

    fun post(target: LocalNotificationTarget): Boolean {
        if (LocalNotificationTarget.from(target.accountId, target.teamId, target.sessionId) != target ||
            account() != target.accountId || !aiAllowed() ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED ||
            !manager.areNotificationsEnabled()) return false
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Conversation updates", NotificationManager.IMPORTANCE_DEFAULT))
        if (manager.getNotificationChannel(CHANNEL).importance == NotificationManager.IMPORTANCE_NONE) return false
        val intent = Intent(context, MainActivity::class.java).setAction(ACTION)
            .setData(Uri.Builder().scheme("nuphos-local").authority("conversation")
                .appendPath(target.accountId).appendPath(target.teamId).appendPath(target.sessionId).build())
            .putExtra(ACCOUNT, target.accountId).putExtra(TEAM, target.teamId).putExtra(SESSION, target.sessionId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Nuphos")
            .setContentText("Open conversation history")
            .setContentIntent(tap).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        manager.notify(TAG, target.hashCode(), notification)
        return true
    }

    companion object {
        const val CHANNEL = "conversation_updates"
        const val TAG = "nuphos-local"
        const val ACTION = "ai.nuphos.android.LOCAL_NOTIFICATION"
        const val ACCOUNT = "notification_account"
        const val TEAM = "notification_team"
        const val SESSION = "notification_session"
    }
}
