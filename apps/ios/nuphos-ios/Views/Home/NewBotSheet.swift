import SwiftUI

/// "+" on Bots: a name and a face, then the new Bot's 1:1 chat opens (#1691).
/// It stays open, with what was picked, when creating fails, and says why.
struct NewBotSheet: View {
    let create: (_ title: String, _ avatar: String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var face = BotAvatars.files.randomElement()!.replacingOccurrences(of: ".svg", with: "")
    @State private var creating = false
    @State private var failure: String?
    @FocusState private var nameFocused: Bool

    private var title: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private let faces = BotAvatars.files.map { $0.replacingOccurrences(of: ".svg", with: "") }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Image(BotAvatars.asset(named: face) ?? "").resizable().scaledToFit()
                        .frame(width: 88, height: 88)
                        .accessibilityHidden(true)
                    TextField("Name", text: $name)
                        .focused($nameFocused)
                        .submitLabel(.done)
                        .padding(.horizontal, 14)
                        .frame(height: 44)
                        .background(Theme.muted.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 6), spacing: 10) {
                        ForEach(faces, id: \.self) { option in
                            Button { face = option } label: {
                                Image(BotAvatars.asset(named: option) ?? "").resizable().scaledToFit()
                                    .padding(3)
                                    .overlay(Circle().stroke(option == face ? Theme.heading : .clear, lineWidth: 2))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(option)
                            .accessibilityAddTraits(option == face ? .isSelected : [])
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.canvas)
            .navigationTitle("New Bot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        creating = true
                        Task {
                            do {
                                try await create(title, face)
                                dismiss()
                            } catch {
                                failure = error.localizedDescription
                            }
                            creating = false
                        }
                    }
                    .disabled(title.isEmpty || title.count > 120 || creating)
                }
            }
            .onAppear { nameFocused = true }
            .alert("Couldn't create Bot", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        .presentationDetents([.large])
    }
}
