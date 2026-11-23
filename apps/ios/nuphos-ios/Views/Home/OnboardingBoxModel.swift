#if os(iOS)
import QuartzCore
import SwiftUI

/// The Nuphos Box as Desktop's Computers page draws it (BoxDesk.css): a black
/// square box with Nuphos's mark on its top, seen from above at first, then
/// turned toward the viewer so its front, ports and power light show. Each face
/// is a flat view placed in 3D and drawn with real perspective, so anything on
/// the top (the stickers) lies on its surface.
struct OnboardingBox<Top: View>: View, Animatable {
    /// 0 is seen from above; 1 is turned toward the viewer, as Desktop opens it.
    var turn: Double
    /// The power light, 0 off to 1 lit.
    var light: Double = 1
    var side: CGFloat = 150
    /// The mark printed on the top.
    var mark = "NuphosMark"
    /// 0 shut to 1 open: the top swings up on its back edge like a lid, until
    /// its inside, the screen, faces the viewer.
    var lid: Double = 0
    /// What the inside of the lid shows. A box with a screen leaves room above for the open lid.
    var screen: AnyView?
    @ViewBuilder var top: () -> Top

    var animatableData: AnimatablePair<AnimatablePair<Double, Double>, Double> {
        get { AnimatablePair(AnimatablePair(turn, light), lid) }
        set { turn = newValue.first.first; light = newValue.first.second; lid = newValue.second }
    }

    var body: some View {
        let geometry = BoxGeometry(side: side, turn: turn, lid: lid, room: screen != nil)
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: side * 0.18)
                .fill(Color.black.opacity(0.3))
                .frame(width: side - 20, height: side - 16)
                .blur(radius: 10)
                // Room for the blur, so its edge is never cut into a hard line.
                .frame(width: side + BoxGeometry.shadowRoom * 2, height: side + BoxGeometry.shadowRoom * 2)
                .projectionEffect(geometry.ground(in: geometry.frame))
            if lid > 0 {
                // The inside of the box, under the lid.
                RoundedRectangle(cornerRadius: 24 * side / 168)
                    .fill(Color(hex: 0x141416))
                    .overlay(RoundedRectangle(cornerRadius: 24 * side / 168).strokeBorder(Color(hex: 0x2E2E32), lineWidth: 5))
                    .frame(width: side, height: side)
                    .projectionEffect(geometry.deck(in: geometry.frame))
            }
            // The body: the top's outline stacked from the desk up, so the sides keep the top's
            // round corners at every angle and the front never shows as a separate plate.
            ForEach(0..<BoxGeometry.slices, id: \.self) { index in
                // Rounder toward the desk, so the box's lower edge stays soft once its top
                // corners have sharpened.
                let up = CGFloat(index) / CGFloat(BoxGeometry.slices - 1)
                outline(near: near + (1 - up) * max(0, foot - near))
                    .fill(Color(hex: 0x1E1E21))
                    .frame(width: side, height: side)
                    .projectionEffect(geometry.slice(index, in: geometry.frame))
            }
            .opacity(turn > 0.001 ? 1 : 0)
            Group {
                if geometry.lidAngle > .pi / 2, let screen {
                    screenFace(screen)
                } else {
                    topFace(geometry)
                }
            }
            .frame(width: side, height: side)
            .projectionEffect(geometry.top(in: geometry.frame))
            front(geometry)
                .frame(width: side, height: geometry.height + 6, alignment: .top)
                .projectionEffect(geometry.front(in: geometry.frame))
                // The body is already solid underneath, so the front's shading can fade in.
                .opacity(min(1, turn * 3))
        }
        .frame(width: geometry.frame.width, height: geometry.frame.height, alignment: .topLeading)
        .accessibilityHidden(true)
    }

    /// The near corners sharpen as the box turns, as Desktop draws it.
    private var near: CGFloat { 26 * side / 168 - 24 * side / 168 * min(1, turn * 1.5) }

    /// The rounding of the near corners where the box meets the desk.
    private var foot: CGFloat { 12 * side / 168 }

    private func outline(near: CGFloat) -> UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 26 * side / 168, bottomLeadingRadius: near,
            bottomTrailingRadius: near, topTrailingRadius: 26 * side / 168
        )
    }

    private func topFace(_ geometry: BoxGeometry) -> some View {
        outline(near: near)
        .fill(LinearGradient(
            colors: [Color(hex: 0x3C3C41), Color(hex: 0x2A2A2E), Color(hex: 0x222225)],
            startPoint: .topLeading, endPoint: .bottomTrailing))
        .overlay(alignment: .top) {
            UnevenRoundedRectangle(topLeadingRadius: 26 * side / 168, topTrailingRadius: 26 * side / 168)
                .stroke(Color.white.opacity(0.14), lineWidth: 1)
                // Only the lit top edge: the shape's other sides would draw square corners.
                .mask(LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.12)))
        }
        .overlay {
            Image(mark)
                .resizable().renderingMode(.template).scaledToFit()
                .foregroundStyle(.white.opacity(0.95))
                .frame(width: side * (mark == "NuphosMark" ? 0.42 : 0.3))
        }
        .overlay { top() }
    }

    /// The lid's inside, seen from behind once it has swung past upright, so it is
    /// drawn upside down to read the right way up.
    private func screenFace(_ screen: AnyView) -> some View {
        RoundedRectangle(cornerRadius: 26 * side / 168)
            .fill(Color(hex: 0x1B1B1E))
            .overlay {
                screen
                    .clipShape(RoundedRectangle(cornerRadius: 16 * side / 168))
                    .padding(side * 0.045)
            }
            .scaleEffect(x: 1, y: -1)
    }

    private func front(_ geometry: BoxGeometry) -> some View {
        VStack(spacing: 0) {
            ZStack(alignment: .leading) {
                UnevenRoundedRectangle(bottomLeadingRadius: max(5, foot), bottomTrailingRadius: max(5, foot))
                    .fill(LinearGradient(
                        colors: [Color(hex: 0x2E2E32), Color(hex: 0x222225), Color(hex: 0x1B1B1E)],
                        startPoint: .top, endPoint: .bottom))
                    .overlay {
                        LinearGradient(
                            stops: [.init(color: .black.opacity(0.3), location: 0), .init(color: .clear, location: 0.1),
                                    .init(color: .clear, location: 0.9), .init(color: .black.opacity(0.3), location: 1)],
                            startPoint: .leading, endPoint: .trailing)
                    }
                    // Only the face sits inside the round corners, where the body's rounded sides
                    // take over; the ports keep their place.
                    .padding(.horizontal, near)
                // Ports and the light, centred on the face as one group.
                HStack(spacing: 6) {
                    Capsule().fill(Color(hex: 0x0E0E10)).frame(width: 9, height: 3.5)
                    Capsule().fill(Color(hex: 0x0E0E10)).frame(width: 9, height: 3.5)
                    Circle().fill(Color(hex: 0x0E0E10)).frame(width: 4, height: 4)
                    Circle()
                        .fill(Color(hex: 0x6E8BFF).opacity(0.25 + 0.75 * light))
                        .frame(width: 4, height: 4)
                        .shadow(color: Color(hex: 0x6E8BFF).opacity(light), radius: 3)
                        .padding(.leading, side * 0.14)
                }
                .frame(maxWidth: .infinity)
            }
            .frame(height: geometry.height)
            UnevenRoundedRectangle(bottomLeadingRadius: 4, bottomTrailingRadius: 4)
                .fill(Color(hex: 0x09090A))
                .frame(width: side - 28, height: 6)
        }
    }
}

/// Where each face of the box sits in 3D, and where it lands on screen.
struct BoxGeometry {
    let side: CGFloat
    let turn: Double
    var lid: Double = 0
    /// Room above for an open lid.
    var room = false

    /// The box is 5 cm tall on a 12.7 cm square, as Desktop draws it.
    var height: CGFloat { side * 56 / 168 }
    var angle: CGFloat { CGFloat(turn) * 68 * .pi / 180 }
    var frame: CGSize { CGSize(width: side * 1.5, height: side * (room ? 2.2 : 1.35)) }
    /// Opens to 112°, where with the box turned 68° the screen faces the viewer squarely.
    var lidAngle: CGFloat { CGFloat(lid) * 112 * .pi / 180 }

    private var perspective: CATransform3D {
        var t = CATransform3DIdentity
        t.m34 = -1 / (side * 14)
        return t
    }

    /// Turns the whole box, then centres it, so it stays in the middle of its frame as it turns.
    private func rig(in size: CGSize) -> CATransform3D {
        var t = CATransform3DMakeRotation(angle, 1, 0, 0)
        t = CATransform3DConcat(t, CATransform3DMakeTranslation(0, height * sin(angle) / 2 + (room ? side * 0.4 : 0), 0))
        t = CATransform3DConcat(t, perspective)
        return CATransform3DConcat(t, CATransform3DMakeTranslation(size.width / 2, size.height / 2, 0))
    }

    /// Hinged on its back edge.
    func top(in size: CGSize) -> ProjectionTransform {
        var local = CATransform3DMakeTranslation(-side / 2, 0, 0)
        local = CATransform3DConcat(local, CATransform3DMakeRotation(lidAngle, 1, 0, 0))
        local = CATransform3DConcat(local, CATransform3DMakeTranslation(0, -side / 2, height))
        return ProjectionTransform(CATransform3DConcat(local, rig(in: size)))
    }

    static let slices = 40

    /// One layer of the body, from the desk (0) up to just under the top.
    func slice(_ index: Int, in size: CGSize) -> ProjectionTransform {
        let z = height * CGFloat(index) / CGFloat(Self.slices)
        let local = CATransform3DMakeTranslation(-side / 2, -side / 2, z)
        return ProjectionTransform(CATransform3DConcat(local, rig(in: size)))
    }

    func deck(in size: CGSize) -> ProjectionTransform {
        let local = CATransform3DMakeTranslation(-side / 2, -side / 2, height - 1)
        return ProjectionTransform(CATransform3DConcat(local, rig(in: size)))
    }

    static let shadowRoom: CGFloat = 40

    func ground(in size: CGSize) -> ProjectionTransform {
        let local = CATransform3DMakeTranslation(-side / 2 - Self.shadowRoom, -side / 2 - Self.shadowRoom, 0)
        return ProjectionTransform(CATransform3DConcat(local, rig(in: size)))
    }

    /// Hangs from the top's near edge down to the desk.
    func front(in size: CGSize) -> ProjectionTransform {
        var local = CATransform3DMakeTranslation(-side / 2, 0, 0)
        local = CATransform3DConcat(local, CATransform3DMakeRotation(-.pi / 2, 1, 0, 0))
        local = CATransform3DConcat(local, CATransform3DMakeTranslation(0, side / 2, height))
        return ProjectionTransform(CATransform3DConcat(local, rig(in: size)))
    }

    /// A point on the box's front, as a fraction across it and down it, in the frame's coordinates.
    func frontPoint(x: CGFloat, y: CGFloat, in size: CGSize) -> CGPoint {
        let t = CATransform3DConcat(
            CATransform3DConcat(
                CATransform3DConcat(CATransform3DMakeTranslation(-side / 2, 0, 0), CATransform3DMakeRotation(-.pi / 2, 1, 0, 0)),
                CATransform3DMakeTranslation(0, side / 2, height)),
            rig(in: size))
        let px = x * side, py = y * height
        let w = px * t.m14 + py * t.m24 + t.m44
        return CGPoint(x: (px * t.m11 + py * t.m21 + t.m41) / w, y: (px * t.m12 + py * t.m22 + t.m42) / w)
    }
}

/// A character printed as a die-cut sticker: a white border that follows its shape and a soft shadow.
struct OnboardingSticker: View {
    let image: String
    var size: CGFloat = 44

    var body: some View {
        let outline: CGFloat = max(1.2, size * 0.03)
        ZStack {
            ForEach(0..<12, id: \.self) { index in
                let a = Double(index) / 12 * 2 * .pi
                Image(image).resizable().renderingMode(.template).scaledToFit()
                    .foregroundStyle(.white)
                    .offset(x: cos(a) * outline, y: sin(a) * outline)
            }
            Image(image).resizable().scaledToFit()
        }
        .frame(width: size, height: size)
        .compositingGroup()
        .shadow(color: .black.opacity(0.35), radius: 1.5, y: 1)
    }
}

/// A sticker peeled back from its bottom-right corner: the lifted part folds
/// over along a diagonal and shows its pale back, as a real sticker does under
/// a fingernail. Held, it peels a little; let go, it lies flat. `peel` peels it
/// from outside: 1.67 has it all the way off.
struct PeelSticker: View {
    let image: String
    var size: CGFloat = 44
    var peel: Double = 0

    @GestureState private var held = false

    var body: some View {
        let lifted = CGFloat(max(peel, held ? 0.4 : 0)) * size * 1.2
        PeelFold(image: image, size: size, lifted: lifted)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).updating($held) { _, state, _ in state = true })
            .animation(.spring(response: 0.3, dampingFraction: 0.75), value: held)
    }
}

private struct PeelFold: View, Animatable {
    let image: String
    let size: CGFloat
    /// How far up the diagonal the fold has travelled from the corner.
    var lifted: CGFloat

    var animatableData: CGFloat {
        get { lifted }
        set { lifted = newValue }
    }

    var body: some View {
        let p = min(lifted, size * 2)
        // The fold runs from (s - p, s) to (s, s - p); turning half a turn about it lays the
        // lifted corner over the sticker, as its reflection across that line.
        let middle = (size - p / 2) / size
        ZStack {
            OnboardingSticker(image: image, size: size)
                .mask(PeelMask(size: size, peel: p, keep: true))
            if p > 0.5 {
                OnboardingSticker(image: image, size: size)
                    .overlay {
                        LinearGradient(colors: [Color(hex: 0xFBFAF8), Color(hex: 0xD3CFC8)],
                                       startPoint: .bottomTrailing, endPoint: .topLeading)
                            .mask(OnboardingSticker(image: image, size: size))
                    }
                    .mask(PeelMask(size: size, peel: p, keep: false))
                    // A shallow peel folds flat; a deep one stands up off the surface, as a sticker
                    // pulled most of the way off does, instead of lying beside where it was.
                    .rotation3DEffect(.degrees(180 - 75 * min(1, max(0, (p - size * 0.6) / (size * 1.4)))),
                                      axis: (x: 1, y: -1, z: 0),
                                      anchor: UnitPoint(x: middle, y: middle), perspective: 0.35)
                    .shadow(color: .black.opacity(0.28), radius: 2, x: -1, y: -1)
            }
        }
        .frame(width: size, height: size)
    }
}

/// The part of a sticker still stuck down (`keep`), or the corner that has lifted.
private struct PeelMask: Shape {
    let size: CGFloat
    let peel: CGFloat
    let keep: Bool

    /// The square cut by the fold line x + y = 2s - p, keeping one side of it.
    func path(in rect: CGRect) -> Path {
        let s = size, c = 2 * size - peel
        let side: (CGPoint) -> CGFloat = { point in keep ? c - point.x - point.y : point.x + point.y - c }
        let square = [CGPoint.zero, CGPoint(x: s, y: 0), CGPoint(x: s, y: s), CGPoint(x: 0, y: s)]
        var kept: [CGPoint] = []
        for (index, point) in square.enumerated() {
            let next = square[(index + 1) % square.count]
            let a = side(point), b = side(next)
            if a >= 0 { kept.append(point) }
            if (a >= 0) != (b >= 0) {
                let t = a / (a - b)
                kept.append(CGPoint(x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t))
            }
        }
        return Path { path in
            guard let first = kept.first else { return }
            path.move(to: first)
            for point in kept.dropFirst() { path.addLine(to: point) }
            path.closeSubpath()
        }
    }
}

/// `-sticker-debug`: the peel at a few depths, to check the fold lies where it should.
struct StickerPeelDebug: View {
    var body: some View {
        HStack(spacing: 30) {
            ForEach([0.5, 1.0, 1.4, 1.67], id: \.self) { peel in
                PeelSticker(image: "bot-avatar-09-frida", size: 70, peel: peel)
                    .background(Color.gray.opacity(0.2))
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(hex: 0x1C1A17))
    }
}

/// Slapped on: lands from above, slightly too large and tilted, then settles flat.
struct StickerSlap: ViewModifier {
    var placed: Bool
    var tilt: Double

    func body(content: Content) -> some View {
        content
            .scaleEffect(placed ? 1 : 1.9)
            .rotationEffect(.degrees(placed ? tilt : tilt - 18))
            .opacity(placed ? 1 : 0)
    }
}

#endif
