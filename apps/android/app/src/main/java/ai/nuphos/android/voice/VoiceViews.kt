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
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

@Composable
fun VoiceMic(enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(36.dp)) {
        Icon(Icons.Outlined.Mic, contentDescription = stringResource(R.string.shell_voice_input))
    }
}

@Composable
fun VoiceRecordingBar(input: VoiceInput, canSend: Boolean = false, onSendReady: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = input::cancel) { Icon(Icons.Outlined.Close, stringResource(R.string.shell_voice_cancel)) }
        if (input.phase == VoiceInput.Phase.Transcribing) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            Text(stringResource(R.string.shell_voice_transcribing), Modifier.weight(1f).padding(start = 8.dp))
        } else if (input.phase == VoiceInput.Phase.Permission) {
            Text(stringResource(R.string.shell_voice_waiting_permission), Modifier.weight(1f))
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
            Icon(Icons.Outlined.Stop, stringResource(R.string.shell_voice_transcribe_edit))
        }
        FilledIconButton(onClick = { input.finish(onSendReady) }, enabled = input.phase == VoiceInput.Phase.Recording && canSend,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary)) {
            Icon(Icons.Rounded.ArrowUpward, stringResource(R.string.shell_voice_transcribe_send))
        }
    }
}

@Composable
fun VoiceSettingsSection(services: VoiceServices) {
    var prompt by remember { mutableStateOf(runCatching { services.settings.prompt }.getOrDefault(DEFAULT_WHISPER_PROMPT)) }
    var error by remember { mutableStateOf<String?>(null) }
    val saveFailed = stringResource(R.string.shell_voice_prompt_save_failed)
    Text(stringResource(R.string.shell_voice_input), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.shell_voice_subscription))
    OutlinedTextField(value = prompt, onValueChange = {
        prompt = it
        runCatching { services.settings.prompt = it }.onFailure { error = saveFailed }
    }, label = { Text(stringResource(R.string.shell_voice_prompt)) }, modifier = Modifier.fillMaxWidth())
    if (prompt != DEFAULT_WHISPER_PROMPT) TextButton(onClick = {
        runCatching { services.settings.prompt = DEFAULT_WHISPER_PROMPT }.onSuccess { prompt = DEFAULT_WHISPER_PROMPT }
            .onFailure { error = saveFailed }
    }) { Text(stringResource(R.string.shell_voice_reset_prompt)) }
    Text(stringResource(R.string.shell_voice_prompt_help))
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}
