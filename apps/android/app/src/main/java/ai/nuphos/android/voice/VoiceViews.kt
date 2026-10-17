package ai.nuphos.android.voice

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.ensureActive

@Composable
fun VoiceMic(enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(36.dp)) {
        Icon(Icons.Outlined.Mic, contentDescription = "Voice input")
    }
}

@Composable
fun VoiceRecordingBar(input: VoiceInput) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = input::cancel) { Icon(Icons.Outlined.Close, "Cancel voice input") }
        if (input.phase == VoiceInput.Phase.Transcribing) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            Text("Transcribing…", Modifier.weight(1f).padding(start = 8.dp))
        } else if (input.phase == VoiceInput.Phase.Permission) {
            Text("Waiting for microphone permission…", Modifier.weight(1f))
        } else {
            val color = MaterialTheme.colorScheme.primary
            Canvas(Modifier.weight(1f).height(32.dp)) {
                val points = input.levels.takeLast(45)
                val step = size.width / 45
                repeat(45) { index ->
                    val level = points.getOrNull(index - (45 - points.size)) ?: 0f
                    val half = (2.dp.toPx() + level * size.height) / 2
                    drawLine(color, Offset(index * step, center.y - half), Offset(index * step, center.y + half), 2.dp.toPx(), StrokeCap.Round)
                }
            }
            Text("%d:%02d".format(input.seconds / 60, input.seconds % 60), Modifier.padding(horizontal = 8.dp))
        }
        IconButton(onClick = input::finish, enabled = input.phase == VoiceInput.Phase.Recording) {
            Icon(Icons.Outlined.Check, "Finish voice input")
        }
    }
}

@Composable
fun OpenAIKeyDialog(services: VoiceServices, onDismiss: () -> Unit, onSaved: () -> Unit) {
    var key by remember { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    var request by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    fun dismiss() { request?.cancel(); key = ""; onDismiss() }
    AlertDialog(onDismissRequest = ::dismiss, title = { Text("OpenAI API key") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(value = key, onValueChange = { key = it }, enabled = !checking,
                label = { Text("sk-…") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
            Text("Voice input transcribes with OpenAI Whisper using your own API key. The key stays on this device; recordings are sent to OpenAI and billed to your account.")
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }, confirmButton = {
        TextButton(enabled = key.isNotBlank() && !checking, onClick = {
            if (!checking) {
                checking = true
                val candidate = key.trim()
                request = scope.launch {
                    try {
                        services.transport.verify(candidate)
                        kotlinx.coroutines.currentCoroutineContext().ensureActive()
                        services.settings.saveKey(candidate)
                        key = ""
                        onSaved()
                    } catch (e: CancellationException) { throw e }
                    catch (_: Exception) { error = "Could not verify or securely save this key. Check the key and your connection." }
                    finally { checking = false }
                }
            }
        }) { Text(if (checking) "Checking…" else "Save") }
    }, dismissButton = { TextButton(onClick = ::dismiss) { Text("Cancel") } })
}

@Composable
fun VoiceSettingsSection(services: VoiceServices) {
    var hasKey by remember { mutableStateOf(runCatching { services.settings.key() != null }.getOrDefault(false)) }
    var prompt by remember { mutableStateOf(runCatching { services.settings.prompt }.getOrDefault(DEFAULT_WHISPER_PROMPT)) }
    var error by remember { mutableStateOf<String?>(null) }
    Text("Voice input", style = MaterialTheme.typography.titleSmall)
    Text(if (hasKey) "OpenAI API key saved on this device" else "Tap the microphone in the composer to add your OpenAI API key.")
    if (hasKey) TextButton(onClick = {
        runCatching { services.settings.removeKey() }.onSuccess { hasKey = false }.onFailure { error = "Could not remove the API key." }
    }) { Text("Remove OpenAI API key") }
    OutlinedTextField(value = prompt, onValueChange = {
        prompt = it
        runCatching { services.settings.prompt = it }.onFailure { error = "Could not save the prompt." }
    }, label = { Text("Transcription prompt") }, modifier = Modifier.fillMaxWidth())
    if (prompt != DEFAULT_WHISPER_PROMPT) TextButton(onClick = {
        runCatching { services.settings.prompt = DEFAULT_WHISPER_PROMPT }.onSuccess { prompt = DEFAULT_WHISPER_PROMPT }
            .onFailure { error = "Could not save the prompt." }
    }) { Text("Reset prompt") }
    Text("The prompt sets the writing style and spells names Whisper doesn't know. Recordings are sent to OpenAI and billed to your OpenAI account.")
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}
