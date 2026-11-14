import SwiftUI

/// The page name with a chevron that opens the page picker. Rendered large
/// at the top of a page's content and small in the navigation bar once
/// that header scrolls away — both are ordinary menus, so both take taps.
struct PageTitleMenu: View {
    @Binding var selection: HomePage
    var style: Style = .large
    /// Open questions waiting in the Inbox, badged on the menu like the desktop's sidebar.
    var inboxCount = 0

    enum Style { case large, inline, bar }

    var body: some View {
        Menu {
            Picker("Page", selection: $selection) {
                ForEach(HomePage.allCases) { page in
                    Label(page.title, systemImage: page.systemImage)
                        .badge(page == .inbox ? inboxCount : 0)
                        .tag(page)
                }
            }
            .pickerStyle(.inline)
        } label: {
            HStack(alignment: .center, spacing: style == .large ? 8 : 5) {
                Text(selection.title)
                    .font(font)
                if inboxCount > 0 {
                    Text(inboxCount, format: .number)
                        .font(.system(size: 12, weight: .semibold).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(Theme.badge, in: Capsule())
                }
                Image(systemName: "chevron.down")
                    .font(.system(size: style == .large ? 16 : 12, weight: .bold))
                    .foregroundStyle(Theme.muted)
                    // Optically centre on the cap height rather than the
                    // full line box, which sits a touch low.
                    .offset(y: style == .large ? 2 : 1)
            }
            .foregroundStyle(Theme.heading)
            .contentTransition(.numericText())
            .animation(.snappy, value: selection)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Switch page")
        .accessibilityValue(Text("\(Text(selection.title))\(inboxCount > 0 ? ", \(inboxCount) in Inbox" : "")"))
    }

    private var font: Font {
        switch style {
        case .large: .largeTitle.weight(.bold)
        case .bar: .title2.weight(.bold)
        case .inline: .headline
        }
    }
}

/// The large header row at the top of a page. Reports whether it has been
/// scrolled out from under the bar so the inline title can take over.
struct PageTitleHeader: View {
    @Binding var selection: HomePage

    var body: some View {
        PageTitleMenu(selection: $selection, style: .large)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 2)
            .padding(.bottom, 8)
    }

    /// Offset past which the header counts as collapsed.
    static let collapseThreshold: CGFloat = 36
}
