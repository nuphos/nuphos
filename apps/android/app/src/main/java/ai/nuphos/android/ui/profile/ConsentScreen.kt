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
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

@Composable
fun ConsentScreen(user: NuphosUser) {
    val auth = LocalAuthSession.current
    val uri = LocalUriHandler.current
    var account by remember(auth.generation) { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text(stringResource(R.string.profile_consent_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.profile_consent_intro))
        Text(stringResource(R.string.profile_consent_recipients_title), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.profile_consent_recipients_body))
        Text(stringResource(R.string.profile_consent_choice_title), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.profile_consent_choice_body))
        TextButton(onClick = { uri.openUri("https://nuphos.ai/privacy") }) { Text(stringResource(R.string.profile_consent_read_privacy_policy)) }
        auth.consentError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (auth.consentBusy) CircularProgressIndicator()
        Button(onClick = { auth.setAIConsent(true) }, enabled = !auth.consentBusy && auth.consentVersion == AccountApi.AI_CONSENT_VERSION,
            modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.profile_consent_agree)) }
        TextButton(onClick = { account = true }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.profile_consent_not_now)) }
        TextButton(onClick = { auth.loadAIConsent() }, enabled = !auth.consentBusy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.profile_consent_retry)) }
    }
    if (account) ProfileSheet(user) { account = false }
}

/** An unavailable or incompatible lookup is not a request for a new consent decision. */
@Composable
fun ConsentRecoveryScreen(user: NuphosUser) {
    val auth = LocalAuthSession.current
    var account by remember(auth.generation) { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text(stringResource(R.string.profile_consent_recovery_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.profile_consent_recovery_body))
        auth.consentError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (auth.consentBusy) CircularProgressIndicator()
        Button(onClick = { auth.loadAIConsent() }, enabled = !auth.consentBusy,
            modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.profile_consent_retry)) }
        TextButton(onClick = { account = true }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.profile_consent_manage_account)) }
    }
    if (account) ProfileSheet(user) { account = false }
}
