#if os(iOS)
import SwiftUI
import UIKit

/// The Home Screen icon. The icons are rendered by apps/desktop/scripts/render-app-icons.mjs;
/// A is the primary AppIcon, every other one is the alternate icon set `AppIcon-<id>`.
struct AppIconPicker: View {
    private static let characters = ["Napoleon", "Pearl Earring", "Van Gogh", "The Scream", "Son of Man"]
    private static let layouts = ["Classic", "Bleed", "Peek"]
    static let icons: [(id: String, name: String)] = [("A", "Nuphos")]
        + zip("BCDEF", characters).flatMap { letter, character in
            layouts.enumerated().map { ("\(letter)\($0.offset + 1)", "\(character), \($0.element)") }
        }

    static var current: String {
        UIApplication.shared.alternateIconName.map { String($0.dropFirst("AppIcon-".count)) } ?? "A"
    }

    @State private var selected = Self.current

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), spacing: 16)], spacing: 16) {
                ForEach(Self.icons, id: \.id) { icon in
                    Button {
                        selected = icon.id
                        UIApplication.shared.setAlternateIconName(icon.id == "A" ? nil : "AppIcon-\(icon.id)") { error in
                            if error != nil { selected = Self.current }
                        }
                    } label: {
                        Image("AppIconPreview-\(icon.id)")
                            .resizable()
                            .scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .padding(3)
                            .overlay {
                                RoundedRectangle(cornerRadius: 17, style: .continuous)
                                    .stroke(selected == icon.id ? Color.accentColor : .clear, lineWidth: 2.5)
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(icon.name)
                    .accessibilityAddTraits(selected == icon.id ? .isSelected : [])
                }
            }
            .padding()
        }
        .background(Theme.canvas)
        .navigationTitle("App icon")
        .navigationBarTitleDisplayMode(.inline)
    }
}
#endif
