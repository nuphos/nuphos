package ai.nuphos.android.notifications

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.RectF
import android.graphics.Shader
import androidx.compose.ui.graphics.toArgb
import androidx.core.graphics.createBitmap
import ai.nuphos.android.model.RuntimeIdentity
import ai.nuphos.android.ui.theme.avatarBackground
import coil3.ImageLoader
import coil3.executeBlocking
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.svg.SvgDecoder
import coil3.toBitmap

/**
 * Renders a notification sender's image as iOS does: a Bot's face on its picked tint, with its
 * runtime's mark on a small disc; a Task's runtime mark alone on a plain disc. Blocking: call it
 * off the main thread.
 */
internal object NotificationAvatars {
    private const val SIZE = 192
    // iOS draws on 120 points; the same proportions on Android's larger bitmap.
    private const val SCALE = SIZE / 120f

    @Volatile private var loader: ImageLoader? = null

    private fun loader(context: Context): ImageLoader = loader ?: synchronized(this) {
        loader ?: ImageLoader.Builder(context.applicationContext)
            .components { add(SvgDecoder.Factory()) }.build().also { loader = it }
    }

    fun bitmap(context: Context, sender: NotificationSender): Bitmap? = runCatching {
        // iOS systemBackground and label: the mark follows the theme, Claude keeps its own color.
        val dark = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val plate = if (dark) Color.BLACK else Color.WHITE
        val ink = (if (dark) Color.WHITE else Color.BLACK).takeUnless { RuntimeIdentity.originalColor(sender.provider) }
        val mark = { size: Float -> RuntimeIdentity.logo(sender.provider)?.let { load(context, "agent-logos/$it.svg", size.toInt()) } }
        val whole = RectF(0f, 0f, SIZE.toFloat(), SIZE.toFloat())
        val out = createBitmap(SIZE, SIZE)
        val canvas = Canvas(out)
        val file = sender.avatarFile
        if (file == null) {
            val logo = mark(60 * SCALE) ?: return null
            fill(canvas, whole, plate)
            draw(canvas, logo, RectF(30 * SCALE, 30 * SCALE, 90 * SCALE, 90 * SCALE), ink)
            return out
        }
        val face = load(context, "bot-avatars/$file", SIZE) ?: return null
        avatarBackground(sender.background)?.let { fill(canvas, whole, it.toArgb()) }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(face, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        canvas.drawCircle(SIZE / 2f, SIZE / 2f, SIZE / 2f, paint)
        val disc = RectF(74 * SCALE, 74 * SCALE, 106 * SCALE, 106 * SCALE)
        mark(26 * SCALE)?.let { logo ->
            fill(canvas, disc, plate)
            draw(canvas, logo, RectF(disc).apply { inset(3 * SCALE, 3 * SCALE) }, ink)
        }
        out
    }.getOrNull()

    private fun load(context: Context, asset: String, size: Int): Bitmap? {
        val request = ImageRequest.Builder(context)
            .data("file:///android_asset/$asset")
            .size(size)
            .allowHardware(false)
            .build()
        return (loader(context).executeBlocking(request) as? SuccessResult)?.image?.toBitmap(size, size)
    }

    private fun fill(canvas: Canvas, oval: RectF, color: Int) =
        canvas.drawOval(oval, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color })

    private fun draw(canvas: Canvas, image: Bitmap, into: RectF, tint: Int?) =
        canvas.drawBitmap(image, null, into, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            if (tint != null) colorFilter = PorterDuffColorFilter(tint, PorterDuff.Mode.SRC_IN)
        })
}
