import Foundation

/// Timestamp copy for the transcript: relative while recent, absolute after
/// a few hours, and the absolute part in the user's own locale settings
/// (12/24-hour clock, month/day order).
///
///   just now · 5 min ago · 2 hrs ago · 13:30 · Yesterday 13:30 ·
///   2 days ago 13:30 · 13:30, 08/26 · 13:30 08/26/2026
enum ChatTime {
    /// Gap after which a message gets its own timestamp, as in iMessage.
    static let separatorInterval: TimeInterval = 15 * 60

    static func label(for date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 {
            return String(localized: "Just now", comment: "Chat timestamp, under a minute")
        }
        let minutes = Int(seconds / 60)
        if minutes < 60 {
            return String(localized: "\(minutes) min ago", comment: "Chat timestamp, minutes")
        }
        let hours = minutes / 60
        if hours <= 3 {
            return String(localized: "\(hours) hr ago", comment: "Chat timestamp, 1–3 hours")
        }

        let time = date.formatted(date: .omitted, time: .shortened)
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0

        switch days {
        case 0:
            return time
        case 1:
            return String(localized: "Yesterday \(time)", comment: "Chat timestamp, previous day")
        case 2:
            return String(localized: "2 days ago \(time)", comment: "Chat timestamp, two days back")
        default:
            if calendar.isDate(date, equalTo: now, toGranularity: .year) {
                let day = date.formatted(.dateTime.month(.twoDigits).day(.twoDigits))
                return String(localized: "\(time), \(day)", comment: "Chat timestamp, same year: time, month/day")
            }
            let day = date.formatted(.dateTime.month(.twoDigits).day(.twoDigits).year())
            return String(localized: "\(time) \(day)", comment: "Chat timestamp, other year: time month/day/year")
        }
    }

    /// Whether `message` should carry a timestamp given the one before it:
    /// it follows a pause or starts a new day.
    static func showsTimestamp(_ date: Date?, after previous: Date?, calendar: Calendar = .current) -> Bool {
        guard let date else { return false }
        guard let previous else { return true }
        return date.timeIntervalSince(previous) > separatorInterval || calendar.startOfDay(for: date) > calendar.startOfDay(for: previous)
    }
}
