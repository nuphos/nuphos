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

@Composable
internal fun ServerSettings(origin: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var address by remember { mutableStateOf(origin) }
    var error by remember { mutableStateOf<String?>(null) }
    fun save(value: String) {
        try { onSave(value); onDismiss() }
        catch (failure: IllegalArgumentException) { error = failure.message }
        catch (_: IllegalStateException) { error = "Could not save the server. Please try again." }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Server settings") },
        text = {
            Column {
                Text("Use Nuphos Cloud, or enter the HTTPS address of your self-hosted backend.")
                OutlinedTextField(address, onValueChange = { address = it; error = null },
                    label = { Text("Server address") }, placeholder = { Text("https://nuphos.example.com") },
                    singleLine = true, isError = error != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error) }
                if (!BackendOrigin.isCloud(origin)) TextButton(onClick = { save(BackendOrigin.DEFAULT) }) {
                    Text("Use Nuphos Cloud")
                }
            }
        },
        confirmButton = { TextButton(onClick = { save(address) }, enabled = address.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
