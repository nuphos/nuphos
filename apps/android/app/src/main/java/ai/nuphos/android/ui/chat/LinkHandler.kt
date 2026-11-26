package ai.nuphos.android.ui.chat

import ai.nuphos.android.NuphosApplication
import ai.nuphos.android.model.PlanLink
import ai.nuphos.android.session.ConversationLink
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.navigation.NavController

/**
 * What a tapped link in a Task or a chat does: a plan opens its page, a Nuphos conversation
 * opens in the app, and anything else opens in the browser.
 */
@Composable
fun rememberLinkHandler(nav: NavController): (String) -> Unit {
    val uriHandler = LocalUriHandler.current
    val app = LocalContext.current.applicationContext as NuphosApplication
    return remember(nav, uriHandler, app) {
        { url ->
            val plan = PlanLink.target(url)
            val conversation = ConversationLink.parse(url)
            if (plan != null) nav.navigate("plan/${plan.planId}")
            else if (conversation != null) app.conversationLinks.offer(conversation)
            else uriHandler.openUri(url)
        }
    }
}
