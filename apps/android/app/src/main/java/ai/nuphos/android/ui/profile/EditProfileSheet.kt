package ai.nuphos.android.ui.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.LocalAuthSession
import kotlinx.coroutines.launch
import ai.nuphos.android.model.profileValidationError

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditProfileSheet(user: NuphosUser, onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable(user.id) { mutableStateOf(user.name) }
    var username by rememberSaveable(user.id) { mutableStateOf(user.username) }
    var avatar by rememberSaveable(user.id) { mutableStateOf(user.avatarURL) }
    var busy by remember(user.id) { mutableStateOf(false) }
    var error by remember(user.id) { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Edit profile", style = MaterialTheme.typography.headlineSmall)
            OutlinedTextField(name, { name = it; error = null }, label = { Text("Name") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(username, { username = it; error = null }, label = { Text("Username") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(avatar, { avatar = it; error = null }, label = { Text("Profile image URL (optional)") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = {
                error = profileValidationError(name, username, avatar)
                if (error == null && auth.user?.id == user.id) {
                    busy = true
                    val token = auth.token
                    val generation = auth.generation
                    scope.launch {
                        if (auth.token != token || auth.generation != generation || auth.user?.id != user.id) return@launch
                        val saved = auth.updateProfile(name.trim(), username.trim(), avatar.trim())
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
