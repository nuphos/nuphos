package ai.nuphos.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.theme.Violet500
import ai.nuphos.android.ui.theme.Violet700
import coil3.compose.AsyncImage

@Composable
fun NuphosAvatar(
    user: NuphosUser,
    size: Dp = 40.dp,
    modifier: Modifier = Modifier,
) {
    val shape = CircleShape
    Box(
        modifier
            .size(size)
            .clip(shape)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f), shape),
        contentAlignment = Alignment.Center,
    ) {
        val avatar = user.avatar
        if (avatar != null) {
            AsyncImage(
                model = avatar,
                contentDescription = user.displayName,
                modifier = Modifier.size(size),
                contentScale = ContentScale.Crop,
            )
        } else {
            Box(
                Modifier
                    .size(size)
                    .background(Brush.linearGradient(listOf(Violet500, Violet700))),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    user.initials,
                    color = androidx.compose.ui.graphics.Color.White,
                    fontSize = (size.value * 0.36f).sp,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}
