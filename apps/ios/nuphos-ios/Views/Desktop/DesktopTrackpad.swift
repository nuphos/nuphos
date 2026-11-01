import SwiftUI
import UIKit

/// A laptop-style trackpad under the picture: one finger moves the pointer,
/// two scroll with momentum, a tap clicks, a two-finger tap right-clicks, and
/// holding still before moving drags.
struct DesktopTrackpad: UIViewRepresentable {
    let desktop: DesktopSession

    func makeUIView(context: Context) -> DesktopTrackpadView { DesktopTrackpadView(desktop: desktop) }
    func updateUIView(_ view: DesktopTrackpadView, context: Context) {}
    static func dismantleUIView(_ view: DesktopTrackpadView, coordinator: ()) { view.momentum.stop() }
}

/// Reads raw touches rather than gesture recognizers, which hold a movement
/// back until it passes their threshold and then jump: here the pointer moves
/// from the first point of travel.
final class DesktopTrackpadView: UIView {
    private let desktop: DesktopSession
    private let haptic = UIImpactFeedbackGenerator(style: .rigid)
    let momentum = ScrollMomentum()
    private var touching = Set<UITouch>()
    private var last = CGPoint.zero
    private var lastTime: CFTimeInterval = 0
    private var began: CFTimeInterval = 0
    private var velocity = CGPoint.zero
    private var travelled: CGFloat = 0
    private var mostFingers = 0
    private var dragging = false
    private var hold: Timer?

    init(desktop: DesktopSession) {
        self.desktop = desktop
        super.init(frame: .zero)
        isMultipleTouchEnabled = true
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private var centroid: CGPoint {
        let points = touching.map { $0.location(in: self) }
        guard !points.isEmpty else { return last }
        return CGPoint(x: points.map(\.x).reduce(0, +) / CGFloat(points.count), y: points.map(\.y).reduce(0, +) / CGFloat(points.count))
    }

    /// Remote pixels per point of finger travel: a swipe across the pad
    /// crosses 1.25 widths of what the picture shows, the same both ways.
    private var speed: CGFloat {
        let shown = desktop.visibleRect.width > 0 ? desktop.visibleRect.width : desktop.screenSize.width
        return 1.25 * shown / max(bounds.width, 1)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard desktop.controlling else { return }
        let first = touching.isEmpty
        touching.formUnion(touches)
        last = centroid
        lastTime = CACurrentMediaTime()
        guard first else {
            mostFingers = max(mostFingers, touching.count)
            hold?.invalidate()
            return
        }
        // Two fingers landing stop a coasting scroll; one finger does not, so
        // the pointer can move while it settles.
        if touching.count > 1 { momentum.stop() }
        haptic.prepare()
        began = lastTime
        mostFingers = touching.count
        travelled = 0
        velocity = .zero
        dragging = false
        hold = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.armDrag() }
        }
    }

    private func armDrag() {
        guard touching.count == 1, mostFingers == 1, travelled < 6 else { return }
        momentum.stop()
        dragging = true
        haptic.impactOccurred(intensity: 1)
        desktop.press(.left)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard !touching.isEmpty else { return }
        let point = centroid
        let now = CACurrentMediaTime()
        let delta = CGPoint(x: point.x - last.x, y: point.y - last.y)
        let elapsed = max(now - lastTime, 1 / 240)
        velocity = CGPoint(x: velocity.x * 0.5 + delta.x / elapsed * 0.5, y: velocity.y * 0.5 + delta.y / elapsed * 0.5)
        last = point
        lastTime = now
        travelled += hypot(delta.x, delta.y)
        if travelled >= 6 { hold?.invalidate() }
        if touching.count > 1 {
            momentum.stop()
            desktop.scroll(by: CGSize(width: delta.x, height: delta.y))
        } else {
            if mostFingers == 1 { momentum.stop() }
            desktop.movePointer(by: CGSize(width: delta.x * speed, height: delta.y * speed))
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { lift(touches, cancelled: false) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { lift(touches, cancelled: true) }

    private func lift(_ touches: Set<UITouch>, cancelled: Bool) {
        guard !touching.isEmpty else { return }
        touching.subtract(touches)
        guard touching.isEmpty else {
            // A finger left a scroll: carry on from where the rest are, without a jump.
            last = centroid
            return
        }
        hold?.invalidate()
        if dragging {
            desktop.release(.left)
            haptic.impactOccurred(intensity: 0.5)
        } else if !cancelled, travelled < 6, CACurrentMediaTime() - began < 0.35 {
            desktop.click(mostFingers > 1 ? .right : .left)
            haptic.impactOccurred(intensity: 0.8)
        } else if mostFingers > 1, !cancelled, CACurrentMediaTime() - lastTime < 0.05 {
            momentum.start(velocity: velocity) { [weak self] delta in self?.desktop.scroll(by: delta) }
        }
        dragging = false
    }
}
