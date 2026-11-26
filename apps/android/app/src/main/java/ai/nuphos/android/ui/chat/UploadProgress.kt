package ai.nuphos.android.ui.chat

import ai.nuphos.android.R
import ai.nuphos.android.data.AttachmentTransfers
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/**
 * A file size as iOS writes it (ByteCountFormatter, `.file` style): 1000 bytes to a kB, whole kB,
 * MB to one decimal and GB and up to two, rounded half to even without trailing zeros. Under 1 kB
 * it is a count of bytes, which the app's language words.
 */
object ByteCount {
    /** [number] in the viewer's locale; [unit] is null when [number] counts bytes. */
    data class Amount(val number: String, val unit: String?)

    private val units = listOf("kB", "MB", "GB", "TB", "PB", "EB")
    private val thousand = BigDecimal(1000)

    fun file(bytes: Long, locale: Locale): Amount {
        val format = NumberFormat.getNumberInstance(locale).apply { minimumFractionDigits = 0; maximumFractionDigits = 2 }
        // Nothing yet reads as kB, as on iOS.
        if (bytes <= 0) return Amount(format.format(0), units.first())
        if (bytes < 1000) return Amount(format.format(bytes), null)
        val value = BigDecimal(bytes)
        var unit = 0
        while (unit < units.lastIndex && value >= thousand.pow(unit + 2)) unit++
        var scaled = scaled(value, unit)
        // 999.96 MB rounds to 1000.0 MB, which is written as 1 GB.
        if (scaled >= thousand && unit < units.lastIndex) scaled = scaled(value, ++unit)
        return Amount(format.format(scaled.stripTrailingZeros()), units[unit])
    }

    private fun scaled(value: BigDecimal, unit: Int): BigDecimal =
        value.divide(thousand.pow(unit + 1)).setScale(if (unit < 2) unit else 2, RoundingMode.HALF_EVEN)
}

/** [bytes] as iOS shows a file's size, in the app's language. */
@Composable
internal fun fileSize(bytes: Long): String {
    val amount = ByteCount.file(bytes, LocalConfiguration.current.locales[0])
    return if (amount.unit == null) pluralStringResource(R.plurals.chat_byte_count, bytes.toInt(), amount.number)
    else stringResource(R.string.chat_byte_count_unit, amount.number, amount.unit)
}

/** The line under a message whose files are on their way up. */
enum class UploadLine { Preparing, Uploading, Checking, Sending, Ready }

/**
 * As iOS, once every byte is out the message reads as sending while the store checks the files;
 * a check before anything is sent (a retried upload) still says it is checking.
 */
fun uploadLine(progress: AttachmentTransfers.Progress): UploadLine = when (progress.stage) {
    AttachmentTransfers.Stage.Intent -> UploadLine.Preparing
    AttachmentTransfers.Stage.Uploading -> UploadLine.Uploading
    AttachmentTransfers.Stage.Finalizing -> if (progress.filesSent) UploadLine.Sending else UploadLine.Checking
    AttachmentTransfers.Stage.Ready -> UploadLine.Ready
}

/** Where a message's files are on their way up, worded the same in a Task's chat and a Bot's. */
@Composable
internal fun uploadProgressText(progress: AttachmentTransfers.Progress): String = when (uploadLine(progress)) {
    UploadLine.Preparing -> stringResource(R.string.chat_upload_preparing)
    UploadLine.Uploading -> stringResource(R.string.chat_upload_progress, fileSize(progress.bytesWritten), fileSize(progress.totalBytes))
    UploadLine.Checking -> stringResource(R.string.chat_upload_checking)
    UploadLine.Sending -> stringResource(R.string.chat_upload_sending)
    UploadLine.Ready -> stringResource(R.string.chat_upload_ready)
}
