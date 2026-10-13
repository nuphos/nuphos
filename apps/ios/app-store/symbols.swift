// Renders SF Symbols to black PNGs (for CSS masks) and prints their point sizes at 60pt.
import AppKit
let out = CommandLine.arguments[1]
let names = ["chevron.down", "magnifyingglass", "line.3.horizontal.decrease", "chevron.right", "chevron.left", "ellipsis", "mic", "arrow.up", "stop.fill", "plus", "checkmark", "info.circle", "wifi", "cellularbars", "battery.100percent", "laptopcomputer", "cloud.fill", "person.2.fill", "bell.fill", "lock.fill", "desktopcomputer", "iphone", "moon.zzz.fill", "bolt.fill", "wrench.and.screwdriver", "hammer", "checkmark.circle.fill", "arrow.triangle.2.circlepath"]
let weights: [(String, NSFont.Weight)] = [("regular", .regular), ("medium", .medium), ("semibold", .semibold), ("bold", .bold)]
var sizes: [String: [Double]] = [:]
for n in names { for (wn, w) in weights {
  guard let base = NSImage(systemSymbolName: n, accessibilityDescription: nil),
        let img = base.withSymbolConfiguration(.init(pointSize: 60, weight: w)) else { continue }
  let s = img.size, scale: CGFloat = 4
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(s.width * scale), pixelsHigh: Int(s.height * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = s
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  img.draw(in: NSRect(origin: .zero, size: s)); NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(n)-\(wn).png"))
  sizes["\(n)-\(wn)"] = [Double(s.width), Double(s.height)]
} }
try! JSONSerialization.data(withJSONObject: sizes).write(to: URL(fileURLWithPath: "\(out)/sizes.json"))
print("symbols", sizes.count)
