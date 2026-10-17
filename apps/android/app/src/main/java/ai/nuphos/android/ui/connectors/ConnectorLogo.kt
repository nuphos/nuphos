package ai.nuphos.android.ui.connectors

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.svg.SvgDecoder

private val logos = mapOf(
        "aws" to ("logo-aws-light.svg" to "logo-aws-dark.svg"),
        "gcp" to ("logo-gcp-light.svg" to "logo-gcp-light.svg"),
        "azure" to ("logo-azure-light.svg" to "logo-azure-light.svg"),
        "cloudflare" to ("logo-cloudflare-light.svg" to "logo-cloudflare-light.svg"),
        "linode" to ("logo-linode-light.png" to "logo-linode-light.png"),
        "hetzner" to ("logo-hetzner-light.svg" to "logo-hetzner-light.svg"),
        "tencent" to ("logo-tencent-light.svg" to "logo-tencent-light.svg"),
        "aliyun" to ("logo-aliyun-light.svg" to "logo-aliyun-light.svg"),
        "volcengine" to ("logo-volcengine-light.svg" to "logo-volcengine-light.svg"),
        "zeabur" to ("logo-zeabur-light.svg" to "logo-zeabur-dark.svg"),
        "betterstack" to ("logo-betterstack-light.svg" to "logo-betterstack-light.svg"),
        "grafana" to ("logo-grafana-light.svg" to "logo-grafana-light.svg"),
        "sentry" to ("logo-sentry-light.svg" to "logo-sentry-light.svg"),
        "tailscale" to ("logo-tailscale-light.svg" to "logo-tailscale-dark.svg"),
        "vanta" to ("logo-vanta-light.png" to "logo-vanta-light.png"),
        "secureframe" to ("logo-secureframe-light.png" to "logo-secureframe-light.png"),
        "sonarqube" to ("logo-sonarqube-light.svg" to "logo-sonarqube-light.svg"),
        "github" to ("logo-github-light.svg" to "logo-github-dark.svg"),
        "gitlab" to ("logo-gitlab-light.svg" to "logo-gitlab-light.svg"),
        "linear" to ("logo-linear-light.svg" to "logo-linear-light.svg"),
        "jira" to ("logo-jira-light.svg" to "logo-jira-light.svg"),
        "asana" to ("logo-asana-light.svg" to "logo-asana-light.svg"),
        "notion" to ("logo-notion-light.svg" to "logo-notion-dark.svg"),
        "plaud" to ("logo-plaud-light.svg" to "logo-plaud-light.svg"),
        "upstash" to ("logo-upstash-light.svg" to "logo-upstash-light.svg"),
        "resend" to ("logo-resend-light.svg" to "logo-resend-light.svg"),
        "posthog" to ("logo-posthog-light.svg" to "logo-posthog-light.svg"),
        "onprem" to ("logo-kubernetes-light.svg" to "logo-kubernetes-light.svg"),
        "uptimeKuma" to ("logo-uptime-kuma-light.svg" to "logo-uptime-kuma-light.svg"),
)

@Composable
fun rememberConnectorImageLoader(): ImageLoader {
    val context = LocalContext.current
    val loader = remember(context) { ImageLoader.Builder(context).components { add(SvgDecoder.Factory()) }.build() }
    DisposableEffect(loader) { onDispose { loader.shutdown() } }
    return loader
}

@Composable
fun ConnectorLogo(provider: String, loader: ImageLoader) {
    val files = logos[provider]
    if (files == null) Text(provider.take(2).uppercase())
    else AsyncImage(model = "file:///android_asset/connector-logos/${if (isSystemInDarkTheme()) files.second else files.first}",
        imageLoader = loader, contentDescription = ai.nuphos.android.model.ConnectorCatalog.named(provider)?.title ?: provider, modifier = Modifier.size(28.dp))
}
