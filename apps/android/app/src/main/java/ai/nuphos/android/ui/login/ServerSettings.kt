package ai.nuphos.android.ui.login

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import ai.nuphos.android.data.BackendOrigin
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

@Composable
internal fun ServerSettings(origin: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var address by remember { mutableStateOf(origin) }
    var error by remember { mutableStateOf<String?>(null) }
    val saveFailed = stringResource(R.string.shell_server_save_failed)
    fun save(value: String) {
        try { onSave(value); onDismiss() }
        catch (failure: IllegalArgumentException) { error = failure.message }
        catch (_: IllegalStateException) { error = saveFailed }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.shell_server_settings)) },
        text = {
            Column {
                Text(stringResource(R.string.shell_server_body))
                OutlinedTextField(address, onValueChange = { address = it; error = null },
                    label = { Text(stringResource(R.string.shell_server_address)) }, placeholder = { Text("https://nuphos.example.com") },
                    singleLine = true, isError = error != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error) }
                if (!BackendOrigin.isCloud(origin)) TextButton(onClick = { save(BackendOrigin.DEFAULT) }) {
                    Text(stringResource(R.string.shell_use_nuphos_cloud))
                }
            }
        },
        confirmButton = { TextButton(onClick = { save(address) }, enabled = address.isNotBlank()) { Text(stringResource(R.string.shell_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
