package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import ai.nuphos.android.ui.LocalAgentStore
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

/** Guidance shown while the workspace has no runtime. A Box still coming up is awaited, not sent to Desktop. */
@Composable
fun FirstRuntimePrompt() {
    val store = LocalAgentStore.current
    val box = store.startingBox
    if (box == null) {
        EmptyState(
            icon = Icons.Outlined.Memory,
            title = stringResource(R.string.agent_first_runtime_title),
            body = stringResource(R.string.agent_first_runtime_body),
        )
        return
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(store, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                delay(5_000)
                store.refreshRuntimes()
            }
        }
    }
    EmptyState(
        icon = Icons.Outlined.Memory,
        title = stringResource(R.string.agent_first_runtime_starting_title, box),
        body = stringResource(R.string.agent_first_runtime_starting_body),
    )
}
