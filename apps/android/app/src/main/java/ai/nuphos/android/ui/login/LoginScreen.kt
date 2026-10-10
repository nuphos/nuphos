package ai.nuphos.android.ui.login

import androidx.activity.compose.LocalActivity
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Error
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAuthSession

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun LoginScreen(modifier: Modifier = Modifier) {
    val auth = LocalAuthSession.current
    val activity = LocalActivity.current
    val busy = auth.state is AuthSession.State.SigningIn
    val error = (auth.state as? AuthSession.State.SignedOut)?.error

    Box(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.28f),
                            Color.Transparent,
                        ),
                        radius = 900f,
                    ),
                ),
        )
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(horizontal = 24.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))
            Surface(
                modifier = Modifier.size(112.dp),
                shape = RoundedCornerShape(36.dp),
                color = MaterialTheme.colorScheme.primary,
                shadowElevation = 6.dp,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        painterResource(R.drawable.ic_nuphos_mark),
                        contentDescription = null,
                        modifier = Modifier.size(72.dp),
                        tint = MaterialTheme.colorScheme.onPrimary,
                    )
                }
            }
            Spacer(Modifier.height(28.dp))
            Text(
                stringResource(R.string.welcome_title),
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                stringResource(R.string.welcome_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.weight(1f))
            AnimatedVisibility(visible = !error.isNullOrEmpty()) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp),
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.errorContainer,
                ) {
                    androidx.compose.foundation.layout.Row(
                        Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Rounded.Error, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                        Spacer(Modifier.size(12.dp))
                        Text(error.orEmpty(), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            Button(
                onClick = { activity?.let(auth::signIn) },
                enabled = !busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shapes = ButtonDefaults.shapes(shape = MaterialTheme.shapes.extraLarge),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 2.dp),
            ) {
                if (busy) {
                    LoadingIndicator(Modifier.size(22.dp), color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.size(10.dp))
                }
                Text(
                    if (busy) stringResource(R.string.signing_in) else stringResource(R.string.sign_in),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            Text(
                stringResource(R.string.sign_in_hint),
                modifier = Modifier.padding(top = 14.dp, bottom = 8.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                textAlign = TextAlign.Center,
            )
        }
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
