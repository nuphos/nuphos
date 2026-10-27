import ActivityKit
import SwiftUI
import WidgetKit

@main
struct NuphosWidgets: WidgetBundle {
    var body: some Widget {
        TurnActivityWidget()
    }
}

/// One card for every running conversation (`TurnCard`). A row opens its
/// conversation; anywhere else opens the conversation list.
struct TurnActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TurnActivityAttributes.self) { context in
            TurnCard(card: context.state)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(SessionLink.conversations)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TurnCardMark(size: 22).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TurnCardStatus(card: context.state).font(.subheadline.weight(.medium)).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TurnCardRows(card: context.state)
                }
            } compactLeading: {
                TurnCardMark(size: 18)
            } compactTrailing: {
                TurnCardCount(card: context.state)
            } minimal: {
                TurnCardCount(card: context.state)
            }
            .widgetURL(SessionLink.conversations)
        }
    }
}
