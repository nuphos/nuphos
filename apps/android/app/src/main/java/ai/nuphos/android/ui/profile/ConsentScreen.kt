package ai.nuphos.android.ui.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.LocalAuthSession

@Composable
fun ConsentScreen(user: NuphosUser) {
    val auth = LocalAuthSession.current
    val uri = LocalUriHandler.current
    var account by remember(auth.generation) { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text("Before you use AI agents", style = MaterialTheme.typography.headlineMedium)
        Text("Using an agent sends your prompts, conversation history, uploaded images and files, and relevant results from connected tools to the providers needed to carry out your request.")
        Text("Who receives this data", style = MaterialTheme.typography.titleMedium)
        Text("Depending on your agent and model, this includes Anthropic (Claude), OpenAI (Codex), Google, or Amazon Web Services. Nuphos also uses Braintrust to store AI execution traces, which can include conversation and tool content, for diagnostics and service improvement.")
        Text("Your choice", style = MaterialTheme.typography.titleMedium)
        Text("Only share information you are authorized to share. You can decline and still manage your account or request its deletion. You can withdraw permission in Account → AI data sharing. Withdrawal stops new AI use from this app; it does not undo completed transfers or stop work already running, including work started on other devices or by scheduled agents.")
        TextButton(onClick = { uri.openUri("https://nuphos.ai/privacy") }) { Text("Read the privacy policy") }
        auth.consentError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (auth.consentBusy) CircularProgressIndicator()
        Button(onClick = { auth.setAIConsent(true) }, enabled = !auth.consentBusy && auth.consentVersion == AccountApi.AI_CONSENT_VERSION,
            modifier = Modifier.fillMaxWidth()) { Text("Agree and continue") }
        TextButton(onClick = { account = true }, modifier = Modifier.fillMaxWidth()) { Text("Not now — manage my account") }
        TextButton(onClick = { auth.loadAIConsent() }, enabled = !auth.consentBusy, modifier = Modifier.fillMaxWidth()) { Text("Retry loading consent") }
    }
    if (account) ProfileSheet(user) { account = false }
}
