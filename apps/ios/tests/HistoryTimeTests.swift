import Foundation

@main
enum HistoryTimeTests {
    static func main() {
        let calendar = Calendar.current
        let now = calendar.date(from: DateComponents(year: 2026, month: 11, day: 26, hour: 9, minute: 41))!
        func ago(days: Int, hour: Int = 23) -> Date {
            calendar.date(byAdding: .day, value: -days, to: calendar.date(bySettingHour: hour, minute: 0, second: 0, of: now)!)!
        }
        // Today shows the time, the day before says so, then the weekday within the week.
        let today = calendar.date(bySettingHour: 0, minute: 5, second: 0, of: now)!
        precondition(HistoryTime.stamp(today, now: now) == today.formatted(date: .omitted, time: .shortened))
        precondition(HistoryTime.stamp(ago(days: 1), now: now) == "Yesterday")
        precondition(HistoryTime.stamp(ago(days: 1, hour: 0), now: now) == "Yesterday")
        precondition(HistoryTime.stamp(ago(days: 6), now: now) == ago(days: 6).formatted(.dateTime.weekday(.wide)))
        // A week back and older, the date with a two-digit year.
        let old = HistoryTime.stamp(ago(days: 7), now: now)
        precondition(old.hasSuffix("26") && !old.contains("2026"), old)
        print("History time passed")
    }
}
