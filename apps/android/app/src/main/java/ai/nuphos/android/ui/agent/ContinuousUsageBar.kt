package ai.nuphos.android.ui.agent

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/** The full track stays beneath the fill, including its rounded trailing edge. */
@Composable
internal fun ContinuousUsageBar(
    progress: Float,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.primaryContainer,
) {
    val value = if (progress.isFinite()) progress.coerceIn(0f, 1f) else 0f
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Canvas(modifier.fillMaxWidth().height(4.dp).semantics {
        progressBarRangeInfo = ProgressBarRangeInfo(value, 0f..1f)
    }) {
        val radius = CornerRadius(size.height / 2)
        drawRoundRect(trackColor, cornerRadius = radius)
        val width = size.width * value
        if (width > 0) drawRoundRect(color,
            topLeft = Offset(if (rtl) size.width - width else 0f, 0f),
            size = Size(width, size.height), cornerRadius = radius)
    }
}
