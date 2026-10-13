package ai.nuphos.android.data

import android.content.Context
import ai.nuphos.android.session.ConnectorPending
import ai.nuphos.android.session.ConnectorPendingStorage

class ConnectorPendingPreferences(context: Context, userId: String) : ConnectorPendingStorage {
    private val preferences = context.getSharedPreferences("connector_pending_$userId", Context.MODE_PRIVATE)
    override fun read(): ConnectorPending? {
        val team = preferences.getString("team", null) ?: return null
        val provider = preferences.getString("provider", null) ?: return null
        val state = preferences.getString("state", null) ?: return null
        val expiry = preferences.getLong("expiry", 0)
        return ConnectorPending(team, provider, state, expiry)
    }
    override fun write(pending: ConnectorPending?) {
        preferences.edit().clear().apply {
            if (pending != null) {
                putString("team", pending.teamId)
                putString("provider", pending.provider)
                putString("state", pending.state)
                putLong("expiry", pending.expiresAt)
            }
        }.commit()
    }
}
