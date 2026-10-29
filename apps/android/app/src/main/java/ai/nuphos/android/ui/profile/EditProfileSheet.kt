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
    var name by rememberSaveable(user.id) { mutableStateOf(user.name) }
    var username by rememberSaveable(user.id) { mutableStateOf(user.username) }
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

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Edit profile", style = MaterialTheme.typography.headlineSmall)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                NuphosAvatar(current, size = 56.dp)
                TextButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !busy) {
                    Text(if (current.avatar == null) "Choose photo" else "Change photo")
                }
                if (current.avatar != null) TextButton(onClick = { setAvatar(null) }, enabled = !busy) { Text("Remove photo") }
            }
            OutlinedTextField(name, { name = it; error = null }, label = { Text("Name") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(username, { username = it; error = null }, label = { Text("Username") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = {
                error = profileValidationError(name, username)
                if (error == null && auth.user?.id == user.id) {
                    busy = true
                    val token = auth.token
                    val generation = auth.generation
                    scope.launch {
                        if (auth.token != token || auth.generation != generation || auth.user?.id != user.id) return@launch
                        val saved = auth.updateProfile(name.trim(), username.trim(), current.avatarURL)
                        if (auth.token != token || auth.generation != generation || auth.user?.id != user.id) return@launch
                        busy = false
                        if (saved) onDismiss() else error = auth.profileError ?: "We could not save your profile. Please try again."
                    }
                }
            }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Saving…" else "Save") }
            TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
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
