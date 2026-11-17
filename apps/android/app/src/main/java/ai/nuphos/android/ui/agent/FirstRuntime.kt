package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.runtime.Composable

/** Guidance shown while the workspace has no runtime. */
@Composable
fun FirstRuntimePrompt() {
    EmptyState(
        icon = Icons.Outlined.Memory,
        title = stringResource(R.string.agent_first_runtime_title),
        body = stringResource(R.string.agent_first_runtime_body),
    )
}
