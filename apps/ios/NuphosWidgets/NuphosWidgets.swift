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
            // Nothing sits in the trailing region: it runs into the island's
            // rounded corner and clipped the status there.
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TurnCardMark(size: 22).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TurnIslandExpanded(card: context.state)
                }
            } compactLeading: {
                TurnCardMark(size: 18)
            } compactTrailing: {
                TurnCardCount(card: context.state)
            } minimal: {
                TurnCardCount(card: context.state)
            }
            .keylineTint(context.state.needsYou > 0 ? .orange : nil)
            .widgetURL(SessionLink.conversations)
        }
    }
}
