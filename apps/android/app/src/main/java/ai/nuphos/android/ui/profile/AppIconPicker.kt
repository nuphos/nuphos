package ai.nuphos.android.ui.profile

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ai.nuphos.android.R

// Each icon is a launcher activity-alias `.Icon<id>` in the manifest; the art comes from
// apps/desktop/scripts/render-app-icons.mjs. A is the original mark.
private val APP_ICONS = listOf(
    "A" to listOf(R.drawable.ic_launcher_background, R.drawable.ic_launcher_foreground),
    "B1" to listOf(R.drawable.app_icon_b1), "B2" to listOf(R.drawable.app_icon_b2), "B3" to listOf(R.drawable.app_icon_b3),
    "C1" to listOf(R.drawable.app_icon_c1), "C2" to listOf(R.drawable.app_icon_c2), "C3" to listOf(R.drawable.app_icon_c3),
    "D1" to listOf(R.drawable.app_icon_d1), "D2" to listOf(R.drawable.app_icon_d2), "D3" to listOf(R.drawable.app_icon_d3),
    "E1" to listOf(R.drawable.app_icon_e1), "E2" to listOf(R.drawable.app_icon_e2), "E3" to listOf(R.drawable.app_icon_e3),
    "F1" to listOf(R.drawable.app_icon_f1), "F2" to listOf(R.drawable.app_icon_f2), "F3" to listOf(R.drawable.app_icon_f3),
)
private val NAMES = listOf("Napoleon", "Pearl Earring", "Van Gogh", "The Scream", "Son of Man")
private val LAYOUTS = listOf("Classic", "Bleed", "Peek")

private fun iconName(id: String) =
    if (id == "A") "Nuphos" else "${NAMES["BCDEF".indexOf(id[0])]}, ${LAYOUTS[id[1].digitToInt() - 1]}"

private fun alias(context: Context, id: String) = ComponentName(context, "ai.nuphos.android.Icon$id")

private fun currentAppIcon(context: Context): String = APP_ICONS.map { it.first }.firstOrNull {
    context.packageManager.getComponentEnabledSetting(alias(context, it)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
} ?: "A"

private fun setAppIcon(context: Context, id: String) {
    // Enable the new entry first so the launcher never has none.
    for ((other) in APP_ICONS.sortedBy { it.first != id }) {
        val state = if (other == id) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        context.packageManager.setComponentEnabledSetting(alias(context, other), state, PackageManager.DONT_KILL_APP)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AppIconPicker() {
    val context = LocalContext.current
    var current by remember { mutableStateOf(currentAppIcon(context)) }
    FlowRow(
        Modifier.fillMaxWidth().padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for ((id, layers) in APP_ICONS) {
            val shape = RoundedCornerShape(16.dp)
            Box(
                Modifier
                    .size(56.dp)
                    .border(2.dp, if (current == id) MaterialTheme.colorScheme.primary else Color.Transparent, RoundedCornerShape(18.dp))
                    .padding(4.dp)
                    .clip(shape)
                    .clickable(role = Role.RadioButton) {
                        current = id
                        setAppIcon(context, id)
                    }
                    .semantics {
                        contentDescription = iconName(id)
                        selected = current == id
                    },
            ) {
                // Adaptive layers are 108 dp; the launcher shows the middle 72.
                for (layer in layers) {
                    Image(painterResource(layer), null, Modifier.fillMaxSize().graphicsLayer(scaleX = 1.5f, scaleY = 1.5f))
                }
            }
        }
    }
}
