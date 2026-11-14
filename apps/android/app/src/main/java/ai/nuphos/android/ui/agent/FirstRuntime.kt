package ai.nuphos.android.ui.agent

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.runtime.Composable

/** Guidance shown while the workspace has no runtime. */
@Composable
fun FirstRuntimePrompt() {
    EmptyState(
        icon = Icons.Outlined.Memory,
        title = "Connect your first runtime",
        body = "Open Nuphos on your computer to add a Box or connect your own computer, or ask a workspace administrator to connect one.",
    )
}
