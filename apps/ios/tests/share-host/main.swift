import SwiftUI
import UIKit

// Synthetic sender only: the receiving app and extension are their normal targets.
@main struct ShareTestHost: App {
    var body: some Scene { WindowGroup { ShareSender() } }
}
struct ShareSender: View {
    struct Request: Identifiable { let id = UUID(); let items: [Any] }
    @State private var request: Request?
    var body: some View {
        VStack(spacing: 24) {
            Text("Synthetic system share tests").font(.headline)
            Text("No real account or runtime requests").font(.caption)
            Button("Share text") { show(["Synthetic share 1013 — edit before sending."]) }
            Button("Share URL") { show([URL(string: "https://example.com/share-1013")!]) }
            Button("Share image") {
                let image = UIGraphicsImageRenderer(size: CGSize(width: 160, height: 100)).image { context in
                    UIColor.systemBlue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 160, height: 100))
                    NSString(string: "Synthetic 1013").draw(at: CGPoint(x: 10, y: 40), withAttributes: [.foregroundColor: UIColor.white])
                }
                show([image])
            }
            Button("Share file") {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("synthetic-1013.txt")
                do { try Data("Synthetic file attachment 1013".utf8).write(to: url); show([url]) } catch { }
            }
        }.padding().sheet(item: $request) { SystemShare(items: $0.items) }
    }
    private func show(_ value: [Any]) { request = Request(items: value) }
}
struct SystemShare: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
