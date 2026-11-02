package ai.nuphos.android.ui.profile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.components.NuphosAvatar
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ai.nuphos.android.model.profileValidationError

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditProfileSheet(user: NuphosUser, onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val current = auth.user?.takeIf { it.id == user.id } ?: user
    var busy by remember(user.id) { mutableStateOf(false) }
    var error by remember(user.id) { mutableStateOf<String?>(null) }

    // `uri` null removes the photo.
    fun setAvatar(uri: Uri?) {
        if (auth.user?.id != user.id) return
        busy = true
        error = null
        scope.launch {
            val image = uri?.let { withContext(Dispatchers.IO) { avatarJpeg(context, it) } }
            error = when {
                uri != null && image == null -> "This image could not be read."
                !auth.setAvatar(image) -> auth.profileError ?: "We could not update your photo. Please try again."
                else -> null
            }
            busy = false
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) setAvatar(uri) }

    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background) {
        EditProfileForm(current, busy, error, onDismiss = onDismiss,
            onChoosePhoto = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            onRemovePhoto = { setAvatar(null) }, onSave = { newName, newUsername, _ ->
                error = profileValidationError(newName, newUsername)
                if (!busy && error == null && auth.user?.id == user.id) {
                    busy = true
                    val token = auth.token
                    val generation = auth.generation
                    scope.launch {
                        if (auth.token != token || auth.generation != generation || auth.user?.id != user.id) return@launch
                        val saved = auth.updateProfile(newName.trim(), newUsername.trim(), current.avatarURL)
                        if (auth.token != token || auth.generation != generation || auth.user?.id != user.id) return@launch
                        busy = false
                        if (saved) onDismiss() else error = auth.profileError ?: "We could not save your profile. Please try again."
                    }
                }
            })
    }
}

@Composable
internal fun EditProfileForm(user: NuphosUser, busy: Boolean, error: String?,
    onDismiss: () -> Unit, onChoosePhoto: () -> Unit, onRemovePhoto: () -> Unit, onSave: (String, String, String) -> Unit) {
    var name by rememberSaveable(user.id) { mutableStateOf(user.name) }
    var username by rememberSaveable(user.id) { mutableStateOf(user.username) }
    Column(Modifier.fillMaxWidth().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") }
            Text("Edit profile", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
            TextButton(onClick = { if (!busy) onSave(name, username, user.avatarURL) },
                enabled = !busy && profileValidationError(name, username) == null) { Text(if (busy) "Saving…" else "Save") }
        }
        Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Profile", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                NuphosAvatar(user, size = 56.dp)
                TextButton(onClick = onChoosePhoto, enabled = !busy) {
                    Text(if (user.avatar == null) "Choose photo" else "Change photo")
                }
                if (user.avatar != null) TextButton(onClick = onRemovePhoto, enabled = !busy) { Text("Remove photo") }
            }
            OutlinedTextField(name, { name = it }, label = { Text("Name") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(username, { username = it }, label = { Text("Username") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

/** The centered square of a picked image, at most 1024px, as JPEG. The backend re-encodes it to a 256px WebP. */
private fun avatarJpeg(context: Context, uri: Uri): ByteArray? = runCatching {
    val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
        val scale = minOf(1.0, 1024.0 / minOf(info.size.width, info.size.height))
        decoder.setTargetSize((info.size.width * scale).toInt().coerceAtLeast(1), (info.size.height * scale).toInt().coerceAtLeast(1))
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
    }
    val side = minOf(bitmap.width, bitmap.height)
    val square = Bitmap.createBitmap(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side)
    ByteArrayOutputStream().also { square.compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()
}.getOrNull()
