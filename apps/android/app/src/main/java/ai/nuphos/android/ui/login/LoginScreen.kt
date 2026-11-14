package ai.nuphos.android.ui.login

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.key
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ai.nuphos.android.R
import ai.nuphos.android.data.NuphosWeb
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAuthSession

/** Social providers offered by the server, discovered on each visit like iOS. */
internal sealed interface ProviderOptions {
    data object Loading : ProviderOptions
    data object Failed : ProviderOptions
    data class Ready(val providers: List<NuphosWeb.Provider>) : ProviderOptions
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun LoginScreen(
    modifier: Modifier = Modifier,
    loadProviders: suspend () -> List<NuphosWeb.Provider> = { withContext(Dispatchers.IO) { NuphosWeb.availableProviders() } },
) {
    val auth = LocalAuthSession.current
    val activity = LocalActivity.current
    val scope = rememberCoroutineScope()
    val origin = auth.serverOrigin
    var showServer by remember { mutableStateOf(false) }
    var options by remember(origin) { mutableStateOf<ProviderOptions>(ProviderOptions.Loading) }
    fun refresh() {
        val expectedOrigin = origin
        options = ProviderOptions.Loading
        scope.launch {
            val loaded = try { ProviderOptions.Ready(loadProviders()) }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { ProviderOptions.Failed }
            if (auth.serverOrigin == expectedOrigin) options = loaded
        }
    }
    LaunchedEffect(origin) { refresh() }
    val busy = auth.state is AuthSession.State.SigningIn
    Box(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(MaterialTheme.colorScheme.primary.copy(alpha = 0.28f), Color.Transparent),
                        radius = 900f,
                    ),
                ),
        )
        val challenge = auth.mfaChallenge
        if (challenge != null) MfaLoginContent(auth) else key(origin) {
            EmailLoginContent(
                busy = busy,
                error = (auth.state as? AuthSession.State.SignedOut)?.error,
                onSubmit = auth::emailSignIn,
                onPasswordSubmit = auth::passwordSignIn,
                onCancel = auth::cancelCredentialSignIn,
                onDismissError = auth::dismissSignInError,
                header = {
                    Column(Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Surface(
                            modifier = Modifier.size(88.dp),
                            shape = RoundedCornerShape(28.dp),
                            color = MaterialTheme.colorScheme.primary,
                            shadowElevation = 6.dp,
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(painterResource(R.drawable.ic_nuphos_mark), contentDescription = null,
                                    modifier = Modifier.size(56.dp), tint = MaterialTheme.colorScheme.onPrimary)
                            }
                        }
                        Spacer(Modifier.height(24.dp))
                        Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.displaySmall,
                            color = MaterialTheme.colorScheme.onBackground, textAlign = TextAlign.Center)
                        TextButton(onClick = { showServer = true }, enabled = !busy) {
                            Text(if (ai.nuphos.android.data.BackendOrigin.isCloud(origin)) "Nuphos Cloud · Server settings" else "$origin · Server settings")
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(stringResource(R.string.welcome_body), style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                        if (auth.savedAccounts.isNotEmpty()) {
                            Spacer(Modifier.height(16.dp))
                            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
                                ai.nuphos.android.ui.profile.SavedAccountsList(auth, allowAdding = false)
                            }
                        }
                        if (auth.addingFrom != null) TextButton(onClick = auth::cancelAddAccount, enabled = !busy) {
                            Text("Cancel adding account")
                        }
                    }
                },
                alternatives = {
                    when (val current = options) {
                        ProviderOptions.Loading -> Unit
                        ProviderOptions.Failed -> TextButton(onClick = ::refresh, enabled = !busy,
                            modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Retry sign-in options") }
                        is ProviderOptions.Ready -> if (current.providers.isNotEmpty()) {
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                HorizontalDivider(Modifier.weight(1f))
                                Text("or", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 12.dp))
                                HorizontalDivider(Modifier.weight(1f))
                            }
                            current.providers.forEach { provider ->
                                OutlinedButton(
                                    onClick = { activity?.let { auth.signIn(it, provider) } },
                                    enabled = !busy && activity != null,
                                    modifier = Modifier.fillMaxWidth().height(52.dp),
                                ) { Text("Continue with ${provider.title}", style = MaterialTheme.typography.titleMedium) }
                            }
                        }
                    }
                },
            )
        }
        if (showServer && !busy) ServerSettings(origin, auth::selectServer, onDismiss = { showServer = false })
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun SplashScreen(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                painterResource(R.drawable.ic_nuphos_mark),
                contentDescription = null,
                modifier = Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(MaterialTheme.colorScheme.primary)
                    .padding(16.dp),
                tint = MaterialTheme.colorScheme.onPrimary,
            )
            Spacer(Modifier.height(24.dp))
            LoadingIndicator()
        }
    }
}

/** The last step of a sign-in to an account with two-factor authentication on. */
@Composable
private fun MfaLoginContent(auth: ai.nuphos.android.session.AuthSession) {
    androidx.activity.compose.BackHandler { auth.cancelMfa() }
    Column(Modifier.fillMaxSize().padding(24.dp).padding(top = 72.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Two-factor authentication", style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground)
        Text("Enter the 6-digit code from your authenticator app.", style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        val activity = androidx.activity.compose.LocalActivity.current
        ai.nuphos.android.ui.MfaCodeForm("Sign in", onSubmit = { code ->
            kotlinx.coroutines.suspendCancellableCoroutine<Unit> { done ->
                // A refused code comes back here; a success leaves this screen.
                auth.verifyMfa(code) { message -> done.resumeWith(Result.failure(Exception(message))) }
            }
        }, passkey = if (activity == null) null else ({
            val challenge = auth.mfaChallenge ?: throw IllegalStateException("This sign-in has expired. Sign in again.")
            val answer = ai.nuphos.android.data.Passkeys.answer(
                activity, ai.nuphos.android.data.AccountApi("").signInPasskeyOptions(challenge),
            )
            kotlinx.coroutines.suspendCancellableCoroutine<Unit> { done ->
                auth.verifyMfaPasskey(answer) { message -> done.resumeWith(Result.failure(Exception(message))) }
            }
        }))
        TextButton(onClick = auth::cancelMfa) { Text("Back to sign-in") }
    }
}
