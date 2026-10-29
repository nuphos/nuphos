import AVFoundation
import SwiftUI
import UIKit

/// The remote screen, fitted to the space it has: pinch to zoom, two fingers
/// to pan. Once the desktop is taken over, a tap clicks at once (the computer
/// counts double clicks itself), holding right-clicks or, moved, drags, and
/// one finger scrolls with momentum.
struct DesktopCanvas: UIViewRepresentable {
    let desktop: DesktopSession

    func makeUIView(context: Context) -> DesktopCanvasView { DesktopCanvasView(desktop: desktop) }

    func updateUIView(_ view: DesktopCanvasView, context: Context) {
        view.screenSize = desktop.screenSize
        view.controlling = desktop.controlling
    }

    static func dismantleUIView(_ view: DesktopCanvasView, coordinator: ()) { view.momentum.stop() }
}

final class DesktopCanvasView: UIScrollView, UIScrollViewDelegate {
    private let desktop: DesktopSession
    private let screen = UIView()
    private let cursor = CALayer()
    /// A Mac's Nuphos host streams H.264, decoded and shown by this layer; a Box's pixels go to `screen`'s contents.
    private let video = AVSampleBufferDisplayLayer()
    private var cursorHotSpot = CGPoint.zero
    private var cursorSize = CGSize.zero
    private var fitted = CGSize.zero
    private var holdOrigin = CGPoint.zero
    private var holdDragging = false
    private let haptic = UIImpactFeedbackGenerator(style: .rigid)
    let momentum = ScrollMomentum()

    private lazy var tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    private lazy var hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
    private lazy var scroll = UIPanGestureRecognizer(target: self, action: #selector(scrolled(_:)))

    var screenSize = CGSize.zero {
        didSet { if screenSize != oldValue { fitted = .zero; setNeedsLayout() } }
    }

    var controlling = false {
        didSet {
            for recognizer in [tap, hold, scroll] { recognizer.isEnabled = controlling }
            panGestureRecognizer.minimumNumberOfTouches = controlling ? 2 : 1
        }
    }

    init(desktop: DesktopSession) {
        self.desktop = desktop
        super.init(frame: .zero)
        delegate = self
        backgroundColor = .black
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        screen.layer.minificationFilter = .trilinear
        screen.layer.contentsGravity = .resize
        cursor.isHidden = true
        video.videoGravity = .resize
        screen.layer.addSublayer(video)
        screen.layer.addSublayer(cursor)
        addSubview(screen)
        hold.minimumPressDuration = 0.45
        scroll.maximumNumberOfTouches = 1
        for recognizer in [tap, hold, scroll] {
            recognizer.isEnabled = false
            screen.addGestureRecognizer(recognizer)
        }
        screen.layer.contents = desktop.lastFrame
        if let shape = desktop.lastCursor { show(shape) }
        desktop.onFrame = { [weak self] image in self?.screen.layer.contents = image }
        desktop.onVideo = { [weak self] sample in self?.show(sample) }
        desktop.requestKeyframe()
        desktop.onCursor = { [weak self] shape in self?.show(shape) }
        desktop.onPointer = { [weak self] point in self?.place(point, reveal: true) }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard screenSize.width > 0, bounds.width > 0 else { return }
        let scale = min(bounds.width / screenSize.width, bounds.height / screenSize.height)
        let size = CGSize(width: (screenSize.width * scale).rounded(), height: (screenSize.height * scale).rounded())
        if size != fitted {
            fitted = size
            zoomScale = 1
            screen.frame = CGRect(origin: .zero, size: size)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            video.frame = screen.bounds
            CATransaction.commit()
            contentSize = size
            // Up to twice the remote pixels per device pixel, or 3× if that is less.
            maximumZoomScale = max(3, screenSize.width / size.width / traitCollection.displayScale * 2)
            place(desktop.pointer, reveal: false)
        }
        centerContent()
    }

    private func centerContent() {
        let x = max(0, (bounds.width - contentSize.width) / 2)
        let y = max(0, (bounds.height - contentSize.height) / 2)
        contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { screen }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        centerContent()
        reportVisible()
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) { reportVisible() }

    private func reportVisible() {
        guard fitted.width > 0 else { return }
        let k = screenSize.width / fitted.width
        let visible = convert(bounds, to: screen).intersection(screen.bounds)
        desktop.visibleRect = CGRect(x: visible.minX * k, y: visible.minY * k, width: visible.width * k, height: visible.height * k)
    }

    /// A touch on the picture, in remote pixels.
    private func pixel(_ recognizer: UIGestureRecognizer) -> CGPoint {
        let point = recognizer.location(in: screen)
        let k = screenSize.width / max(fitted.width, 1)
        return CGPoint(x: point.x * k, y: point.y * k)
    }

    @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
        momentum.stop()
        desktop.movePointer(to: pixel(recognizer))
        desktop.click()
    }

    @objc private func held(_ recognizer: UILongPressGestureRecognizer) {
        let point = pixel(recognizer)
        switch recognizer.state {
        case .began:
            momentum.stop()
            holdOrigin = recognizer.location(in: self)
            holdDragging = false
            haptic.impactOccurred(intensity: 1)
            desktop.movePointer(to: point)
        case .changed:
            let location = recognizer.location(in: self)
            if !holdDragging, hypot(location.x - holdOrigin.x, location.y - holdOrigin.y) > 8 {
                holdDragging = true
                desktop.press(.left)
            }
            if holdDragging { desktop.movePointer(to: point) }
        case .ended:
            if holdDragging {
                desktop.movePointer(to: point)
                desktop.release(.left)
                haptic.impactOccurred(intensity: 0.5)
            } else {
                desktop.click(.right)
            }
            holdDragging = false
        case .cancelled, .failed:
            if holdDragging { desktop.release(.left) }
            holdDragging = false
        default:
            break
        }
    }

    @objc private func scrolled(_ recognizer: UIPanGestureRecognizer) {
        switch recognizer.state {
        case .began:
            momentum.stop()
            desktop.movePointer(to: pixel(recognizer))
        case .changed:
            let travel = recognizer.translation(in: self)
            recognizer.setTranslation(.zero, in: self)
            desktop.scroll(by: CGSize(width: travel.x, height: travel.y))
        case .ended:
            let velocity = recognizer.velocity(in: self)
            momentum.start(velocity: velocity) { [weak self] delta in self?.desktop.scroll(by: delta) }
        default:
            break
        }
    }

    private func show(_ sample: CMSampleBuffer) {
        if video.status == .failed {
            video.flush()
            desktop.requestKeyframe()
            return
        }
        video.enqueue(sample)
    }

    private func show(_ shape: RFBCursor) {
        cursorHotSpot = CGPoint(x: shape.hotX, y: shape.hotY)
        cursorSize = CGSize(width: shape.width, height: shape.height)
        cursor.contents = shape.image
        cursor.isHidden = false
        place(desktop.pointer, reveal: false)
    }

    /// Draws the pointer here rather than waiting for the computer to: it
    /// follows the finger with no round trip. While zoomed in, the view
    /// follows a pointer the trackpad moves out of sight.
    private func place(_ point: CGPoint, reveal: Bool) {
        guard fitted.width > 0 else { return }
        let k = fitted.width / screenSize.width
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        cursor.frame = CGRect(
            x: (point.x - cursorHotSpot.x) * k, y: (point.y - cursorHotSpot.y) * k,
            width: cursorSize.width * k, height: cursorSize.height * k
        )
        CATransaction.commit()
        guard reveal, controlling, zoomScale > 1, !isTracking else { return }
        let spot = CGRect(x: point.x * k - 24, y: point.y * k - 24, width: 48, height: 48)
        scrollRectToVisible(screen.convert(spot, to: self), animated: false)
    }
}

/// Keeps a scroll going after the finger lifts, the way a Mac's trackpad
/// driver does for its own scrolls but not for injected ones.
final class ScrollMomentum {
    private var link: CADisplayLink?
    private var velocity = CGPoint.zero
    private var last: CFTimeInterval = 0
    private var step: ((CGSize) -> Void)?

    func start(velocity: CGPoint, step: @escaping (CGSize) -> Void) {
        stop()
        guard hypot(velocity.x, velocity.y) > 150 else { return }
        self.velocity = velocity
        self.step = step
        last = CACurrentMediaTime()
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
        step = nil
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = CACurrentMediaTime()
        let elapsed = min(0.1, now - last)
        last = now
        let decay = pow(0.96, elapsed * 60)
        velocity = CGPoint(x: velocity.x * decay, y: velocity.y * decay)
        let delta = CGSize(width: velocity.x * elapsed, height: velocity.y * elapsed)
        guard hypot(delta.width, delta.height) >= 0.3 else { stop(); return }
        step?(delta)
    }
}
