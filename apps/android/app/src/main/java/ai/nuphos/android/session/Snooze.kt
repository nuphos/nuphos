package ai.nuphos.android.session

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/** What an Inbox question can be snoozed for, as Desktop offers it. */
enum class SnoozePreset { Hour, Tomorrow, NextMonday }

/**
 * When an Inbox question can be snoozed until, in local time: an hour from [now], tomorrow at 9:00
 * and next Monday at 9:00. On a Sunday those last two are one, offered once.
 */
fun snoozeTimes(now: ZonedDateTime = ZonedDateTime.now()): List<Pair<SnoozePreset, Instant>> {
    val tomorrow = now.toLocalDate().plusDays(1).atTime(9, 0).atZone(now.zone).toInstant()
    val monday = now.toLocalDate().with(TemporalAdjusters.next(DayOfWeek.MONDAY)).atTime(9, 0).atZone(now.zone).toInstant()
    return listOfNotNull(
        SnoozePreset.Hour to now.toInstant().plusSeconds(3_600),
        SnoozePreset.Tomorrow to tomorrow,
        (SnoozePreset.NextMonday to monday).takeIf { monday != tomorrow },
    )
}

/** When a snoozed question comes back: its time today, else its weekday and time. */
fun returnTime(until: Instant, now: ZonedDateTime = ZonedDateTime.now(), locale: Locale = Locale.getDefault()): String {
    val at = until.atZone(now.zone)
    val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(at)
    return if (at.toLocalDate() == now.toLocalDate()) time
    else "${DateTimeFormatter.ofPattern("EEE", locale).format(at)} $time"
}

/** The most a dismissal's reason may hold: the server refuses a longer one. */
const val DISMISS_REASON_LIMIT = 1_000

/** A dismissal's reason as it is sent: trimmed, within the limit, and null when left empty. */
fun dismissReason(text: String?): String? = text?.trim()?.take(DISMISS_REASON_LIMIT)?.takeIf { it.isNotEmpty() }
