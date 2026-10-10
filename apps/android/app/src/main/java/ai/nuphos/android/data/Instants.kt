package ai.nuphos.android.data

import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

object Instants {
    private val iso = DateTimeFormatter.ISO_OFFSET_DATE_TIME

    fun parse(raw: String?): Instant? {
        if (raw.isNullOrBlank()) return null
        return try {
            Instant.parse(raw)
        } catch (_: DateTimeParseException) {
            try {
                OffsetDateTime.parse(raw, iso).toInstant()
            } catch (_: DateTimeParseException) {
                null
            }
        }
    }

    fun format(instant: Instant): String = instant.toString()
}
