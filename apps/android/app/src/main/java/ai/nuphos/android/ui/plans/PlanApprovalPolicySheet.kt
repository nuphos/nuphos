package ai.nuphos.android.ui.plans

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ai.nuphos.android.ui.LocalPlansStore
import kotlinx.coroutines.launch

@Composable
fun PlanApprovalPolicySheet(onDismiss: () -> Unit) {
    val plans = LocalPlansStore.current
    val scope = rememberCoroutineScope()
    val current = plans.approvalPolicy?.minimumOtherApprovals ?: 0
    var mode by remember { mutableStateOf(if (current == 0) 0 else if (current == 1) 1 else 2) }
    var quorum by remember { mutableFloatStateOf(maxOf(2, current).toFloat()) }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Plan approval") },
        text = {
            Column {
                TextButton(onClick = { mode = 0 }) { Text(if (mode == 0) "●  Requester only" else "○  Requester only") }
                TextButton(onClick = { mode = 1 }) { Text(if (mode == 1) "●  Requester + one other member" else "○  Requester + one other member") }
                TextButton(onClick = { mode = 2 }) { Text(if (mode == 2) "●  Requester + a quorum" else "○  Requester + a quorum") }
                if (mode == 2) {
                    Text("Other members required: ${quorum.toInt()}", modifier = Modifier.padding(top = 8.dp))
                    Slider(value = quorum, onValueChange = { quorum = it }, valueRange = 2f..20f, steps = 17)
                }
                Text(
                    "Changing the policy invalidates approvals on open plans — they must be reviewed again.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val minimum = when (mode) {
                    0 -> 0
                    1 -> 1
                    else -> quorum.toInt()
                }
                scope.launch {
                    runCatching { plans.updateApprovalPolicy(minimum) }
                        .onSuccess { onDismiss() }
                        .onFailure { error = it.message }
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
