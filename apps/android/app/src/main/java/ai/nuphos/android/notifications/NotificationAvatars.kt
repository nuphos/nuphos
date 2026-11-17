package ai.nuphos.android.notifications

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader
import androidx.core.graphics.createBitmap
import coil3.ImageLoader
import coil3.executeBlocking
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.svg.SvgDecoder
import coil3.toBitmap

/** Renders a bundled Bot face for a notification. Blocking: call it off the main thread. */
internal object NotificationAvatars {
    private const val SIZE = 192

    @Volatile private var loader: ImageLoader? = null

    private fun loader(context: Context): ImageLoader = loader ?: synchronized(this) {
        loader ?: ImageLoader.Builder(context.applicationContext)
            .components { add(SvgDecoder.Factory()) }.build().also { loader = it }
    }

    fun bitmap(context: Context, file: String): Bitmap? = runCatching {
        val request = ImageRequest.Builder(context)
            .data("file:///android_asset/bot-avatars/$file")
            .size(SIZE)
            .allowHardware(false)
            .build()
        val image = (loader(context).executeBlocking(request) as? SuccessResult)?.image ?: return null
        circle(image.toBitmap(SIZE, SIZE))
    }.getOrNull()

    private fun circle(source: Bitmap): Bitmap {
        val out = createBitmap(SIZE, SIZE)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        Canvas(out).drawCircle(SIZE / 2f, SIZE / 2f, SIZE / 2f, paint)
        return out
    }
}
