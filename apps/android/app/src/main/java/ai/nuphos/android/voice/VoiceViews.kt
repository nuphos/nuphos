package ai.nuphos.android.voice

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.rounded.ArrowUpward
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
fun VoiceRecordingBar(input: VoiceInput, canSend: Boolean = false, onSendReady: () -> Unit = {}) {
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
        IconButton(onClick = { input.finish() }, enabled = input.phase == VoiceInput.Phase.Recording) {
            Icon(Icons.Outlined.Stop, "Transcribe and edit")
        }
        FilledIconButton(onClick = { input.finish(onSendReady) }, enabled = input.phase == VoiceInput.Phase.Recording && canSend,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary)) {
            Icon(Icons.Rounded.ArrowUpward, "Transcribe and send")
        }
    }
}

@Composable
fun VoiceSettingsSection(services: VoiceServices) {
    var prompt by remember { mutableStateOf(runCatching { services.settings.prompt }.getOrDefault(DEFAULT_WHISPER_PROMPT)) }
    var error by remember { mutableStateOf<String?>(null) }
    Text("Voice input", style = MaterialTheme.typography.titleSmall)
    Text("Voice input is included with a Nuphos subscription.")
    OutlinedTextField(value = prompt, onValueChange = {
        prompt = it
        runCatching { services.settings.prompt = it }.onFailure { error = "Could not save the prompt." }
    }, label = { Text("Transcription prompt") }, modifier = Modifier.fillMaxWidth())
    if (prompt != DEFAULT_WHISPER_PROMPT) TextButton(onClick = {
        runCatching { services.settings.prompt = DEFAULT_WHISPER_PROMPT }.onSuccess { prompt = DEFAULT_WHISPER_PROMPT }
            .onFailure { error = "Could not save the prompt." }
    }) { Text("Reset prompt") }
    Text("The prompt guides spelling and writing style. Recordings are transcribed by OpenAI through Nuphos.")
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}
