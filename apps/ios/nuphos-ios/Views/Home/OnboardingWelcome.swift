#if DEBUG && os(iOS)
import SwiftUI

/// Full-bleed welcome: the website's shared-work table is wrapped into a ring
/// that turns slowly, as if the camera were circling it from outside.
struct OnboardingWelcome: View {
    let signIn: () -> Void
    let useOwnServer: () -> Void

    /// The mist at the bottom edge of the artwork, so the page continues it.
    private static let mist = Color(red: 242 / 255, green: 236 / 255, blue: 230 / 255)
    private static let sky = Color(red: 172 / 255, green: 189 / 255, blue: 224 / 255)
    private static let ink = Color(red: 0.16, green: 0.13, blue: 0.11)

    var body: some View {
        GeometryReader { geometry in
            let insets = geometry.safeAreaInsets
            let wide = geometry.size.width > geometry.size.height
            // A phone on its side has no height for the art above the copy, so they sit side by side.
            if wide && geometry.size.height < 500 {
                sideBySide(geometry)
            } else {
                // A wide screen (a folding phone open, or a tablet on its side) leaves more room for the copy.
                let share = wide ? (geometry.size.height < 600 ? 0.46 : 0.58) : 0.70
                let artHeight = geometry.size.height * share + insets.top
                // The art runs edge to edge, under a side status bar too.
                let artWidth = geometry.size.width + insets.leading + insets.trailing
                ZStack(alignment: .topLeading) {
                    Self.mist.ignoresSafeArea()
                    OnboardingLongTable(mist: Self.mist)
                        .frame(width: artWidth, height: artHeight)
                        .offset(x: -insets.leading, y: -insets.top)
                }
                .frame(height: geometry.size.height, alignment: .top)
                .overlay(alignment: .bottom) {
                    VStack(spacing: 0) {
                        copy
                        actions
                    }
                    .padding(.horizontal, 28)
                    .padding(.bottom, 8)
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .foregroundStyle(Self.ink)
    }

    /// The art fills the leading half, top to bottom and under the side inset; the copy is centred
    /// in the trailing half.
    private func sideBySide(_ geometry: GeometryProxy) -> some View {
        let insets = geometry.safeAreaInsets
        let artWidth = geometry.size.width * 0.52 + insets.leading
        let artHeight = geometry.size.height + insets.top + insets.bottom
        return HStack(spacing: 0) {
            OnboardingLongTable(mist: Self.mist)
                .frame(width: artWidth, height: artHeight)
                .overlay(alignment: .trailing) {
                    // Dissolve the art into the page beside it.
                    LinearGradient(colors: [Self.mist.opacity(0), Self.mist], startPoint: .leading, endPoint: .trailing)
                        .frame(width: 40)
                        .allowsHitTesting(false)
                }
                .offset(x: -insets.leading, y: -insets.top)
                .frame(width: artWidth - insets.leading, height: geometry.size.height, alignment: .topLeading)
            VStack(spacing: 0) {
                copy
                actions
            }
            .padding(.horizontal, 28)
            .frame(maxWidth: 420)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Self.mist.ignoresSafeArea())
    }

    private var copy: some View {
        VStack(spacing: 16) {
            Image("OnboardingLogo")
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(height: 40)
                .accessibilityLabel("Nuphos")
                .accessibilityAddTraits(.isHeader)
            Text("Bring your AI subscriptions to one table,\nand work with your Bots.")
                .font(.system(size: 17, design: .serif).italic())
                .foregroundStyle(Self.ink.opacity(0.68))
                .multilineTextAlignment(.center)
        }
        .padding(.bottom, 32)
    }

    private var actions: some View {
        VStack(spacing: 2) {
            // The design system's primary button, in this page's fixed ink and paper, as the art
            // stays light in Dark Mode.
            Button(action: signIn) {
                Text("Sign in or create an account").frame(maxWidth: .infinity)
            }
            .buttonStyle(WelcomePrimaryButtonStyle(ink: Self.ink, paper: Self.mist))
            Button("Use your own server", action: useOwnServer)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Self.ink.opacity(0.7))
                .frame(minHeight: 44)
        }
    }
}

private struct WelcomePrimaryButtonStyle: ButtonStyle {
    let ink: Color
    let paper: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.medium))
            .padding(.horizontal, 16)
            .frame(minHeight: 48)
            .foregroundStyle(paper)
            .background(ink, in: RoundedRectangle(cornerRadius: 10))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

/// An endless straight table from the website's shared-work art: the Bots
/// slide past slowly while the sea behind them drifts at a slower pace.
private struct OnboardingLongTable: View {
    let mist: Color

    private struct Seat {
        let asset: String
        let size: CGSize
        /// Fraction of the height where the body (arms on the table) ends.
        let rest: CGFloat
    }

    private static let seats = [
        Seat(asset: "RingBot-1-pair", size: CGSize(width: 337, height: 348), rest: 0.894),
        Seat(asset: "RingBot-2-leo", size: CGSize(width: 175, height: 297), rest: 0.916),
        Seat(asset: "RingBot-3-curly", size: CGSize(width: 215, height: 275), rest: 0.92),
        Seat(asset: "RingBot-4-socrates", size: CGSize(width: 331, height: 317), rest: 0.823),
        Seat(asset: "RingBot-5-frida", size: CGSize(width: 185, height: 260), rest: 0.915),
        Seat(asset: "RingBot-6-duo", size: CGSize(width: 521, height: 317), rest: 0.915)
    ]

    /// Seconds for the whole cast to pass once.
    private static let period: Double = 75

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var start = Date.now

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: reduceMotion || scenePhase != .active)) { context in
            let elapsed = reduceMotion ? 0 : context.date.timeIntervalSince(start)
            let turn = 0.08 + elapsed / Self.period
            Canvas { canvas, size in
                draw(in: &canvas, size: size, turn: turn, time: elapsed)
            }
        }
        .overlay(alignment: .bottom) {
            LinearGradient(colors: [mist.opacity(0), mist], startPoint: .top, endPoint: .bottom)
                .frame(height: 56)
                .allowsHitTesting(false)
        }
        .clipped()
        .accessibilityElement()
        .accessibilityLabel("Nuphos Bots working together along a long stone table")
        .accessibilityAddTraits(.isImage)
    }

    private func draw(in canvas: inout GraphicsContext, size: CGSize, turn: Double, time: Double) {
        let width = size.width
        let tableTop = size.height * 0.855
        // Sized by the width on a phone; a wide screen is limited by the height instead,
        // so the Bots' heads stay in the frame.
        let pointsPerPixel = min(width / 402 * 0.84, tableTop * 0.72 / 317)
        let surface: CGFloat = 34
        let botHeight = 317 * pointsPerPixel

        // Cast laid end to end, looping forever.
        let spacing: CGFloat = 0.86
        let widths = Self.seats.map { $0.size.width * pointsPerPixel * spacing }
        let loop = widths.reduce(0, +)
        let travel = CGFloat(turn) * loop

        // Sky, then the sea and balustrade band drifting at a quarter of the cast's pace.
        canvas.draw(canvas.resolve(Image("LongTableSky")), in: CGRect(x: -width * 0.3, y: 0, width: width * 1.6, height: size.height * 0.75))
        let seaBottom = tableTop - botHeight * 0.36
        let seaHeight = botHeight * 0.755
        let seaTile = canvas.resolve(Image("LongTableSea"))
        let seaScale = seaHeight / seaTile.size.height
        let seaRect = CGRect(x: 0, y: seaBottom - seaHeight, width: width, height: seaHeight + botHeight)
        canvas.drawLayer { layer in
            layer.fill(Path(CGRect(x: 0, y: seaRect.minY, width: width, height: seaHeight)),
                       with: .tiledImage(Image("LongTableSea"), origin: CGPoint(x: -travel * 0.25, y: seaRect.minY), scale: seaScale))
            // Dissolve the band's upper sky into the painted sky above.
            layer.blendMode = .destinationOut
            layer.fill(Path(CGRect(x: 0, y: seaRect.minY, width: width, height: seaHeight * 0.45)),
                       with: .linearGradient(Gradient(colors: [.black, .black.opacity(0)]),
                                             startPoint: CGPoint(x: 0, y: seaRect.minY),
                                             endPoint: CGPoint(x: 0, y: seaRect.minY + seaHeight * 0.45)))
        }
        // Stone balustrade below the sea, behind the Bots.
        let stone = Image("RingStone")
        canvas.fill(Path(CGRect(x: 0, y: seaBottom - 2, width: width, height: tableTop - seaBottom + 4)),
                    with: .tiledImage(Image("LongTableFace"), origin: CGPoint(x: -travel * 0.25, y: seaBottom), scale: 0.9))
        canvas.fill(Path(CGRect(x: 0, y: seaBottom - 2, width: width, height: tableTop - seaBottom + 4)),
                    with: .color(.black.opacity(0.08)))

        // Columns framing the scene, as in the footer.
        let columnHeight = min(tableTop + 10, width * 1.12)
        let columnTop = tableTop + 10 - columnHeight
        for (name, leading) in [("LongTableColumnLeft", true), ("LongTableColumnRight", false)] {
            let image = canvas.resolve(Image(name))
            let w = image.size.width * columnHeight / image.size.height
            let rect = CGRect(x: leading ? -w * 0.18 : width - w * 0.82, y: columnTop, width: w, height: columnHeight)
            canvas.drawLayer { layer in
                layer.draw(image, in: rect)
                layer.blendMode = .destinationOut
                layer.fill(Path(CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: 70)),
                           with: .linearGradient(Gradient(colors: [.black, .black.opacity(0)]),
                                                 startPoint: CGPoint(x: 0, y: rect.minY), endPoint: CGPoint(x: 0, y: rect.minY + 70)))
            }
        }

        // The Bots.
        var cursor: CGFloat = 0
        for (index, seat) in Self.seats.enumerated() {
            let slot = widths[index]
            defer { cursor += slot }
            var x = cursor + slot / 2 - travel
            x = x.truncatingRemainder(dividingBy: loop)
            if x < -loop / 2 { x += loop }
            if x >= loop / 2 { x -= loop }
            x += width / 2
            let w = seat.size.width * pointsPerPixel
            let h = seat.size.height * pointsPerPixel
            guard x + w / 2 > -4, x - w / 2 < width + 4 else { continue }
            let bob = reduceMotion ? 0 : sin(time * 0.9 + Double(index) * 1.7) * 1.3
            var bot = canvas
            bot.translateBy(x: x, y: tableTop + surface * 0.6 + bob)
            bot.rotate(by: .degrees(reduceMotion ? 0 : sin(time * 0.5 + Double(index)) * 0.7))
            bot.draw(bot.resolve(Image(seat.asset).interpolation(.high)),
                     in: CGRect(x: -w / 2, y: -h * seat.rest, width: w, height: h))
        }

        // The table: a smooth pale stone top, then cut stone blocks on the front face.
        let faceTop = tableTop + surface
        let faceHeight = max(40, size.height - faceTop)
        let top = Path(CGRect(x: 0, y: tableTop, width: width, height: surface))
        let face = Path(CGRect(x: 0, y: faceTop, width: width, height: faceHeight))
        var table = canvas
        table.fill(top, with: .linearGradient(
            Gradient(colors: [Color(red: 0.93, green: 0.88, blue: 0.81), Color(red: 0.97, green: 0.94, blue: 0.89)]),
            startPoint: CGPoint(x: 0, y: tableTop), endPoint: CGPoint(x: 0, y: faceTop)))
        let blocks = canvas.resolve(Image("LongTableFace"))
        table.fill(face, with: .tiledImage(Image("LongTableFace"), origin: CGPoint(x: -travel, y: faceTop),
                                           scale: faceHeight / blocks.size.height))
        // Rounded lip: a bright edge and a soft shadow just under it.
        table.fill(Path(CGRect(x: 0, y: faceTop - 1.5, width: width, height: 3)), with: .color(.white.opacity(0.55)))
        table.fill(Path(CGRect(x: 0, y: faceTop + 1.5, width: width, height: 10)),
                   with: .linearGradient(Gradient(colors: [.black.opacity(0.12), .black.opacity(0)]),
                                         startPoint: CGPoint(x: 0, y: faceTop + 1.5), endPoint: CGPoint(x: 0, y: faceTop + 11.5)))
    }
}
#endif
