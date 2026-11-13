import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @Environment(AuthSession.self) private var session
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(NuphosAPI.baseURLKey) private var savedURL = ""
    @State private var path: [Screen] = []
    @State private var showingServer = false
    @State private var email = ""
    @State private var credential = ""
    @State private var codeFocused = false
    @State private var usePassword = false
    @State private var busy = false
    @State private var error: String?
    @State private var resendAt = Date.distantPast
    @State private var providers: [NuphosWeb.Provider] = []
    @State private var oidcName = "SSO"
    @State private var loadingProviders = true
    @State private var providerError = false
    @FocusState private var focused: Field?
    @ScaledMetric(relativeTo: .title2) private var codeCellHeight: CGFloat = 56

    private enum Screen: Hashable { case code, mfa }
    private enum Field { case email, password }
    private var signingIn: Bool { busy || session.state == .signingIn }
    private var cleanEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var validEmail: Bool { cleanEmail.contains("@") && !cleanEmail.contains(" ") }
    private var loginButtonFill: Color { colorScheme == .dark ? .white : .black }
    private var loginButtonLabel: Color { colorScheme == .dark ? .black : .white }
    private var validCode: Bool { credential.count == 6 && credential.allSatisfy(\.isNumber) }
    private var canContinue: Bool { validEmail && (!usePassword || !credential.isEmpty) }

    var body: some View {
        NavigationStack(path: $path) {
            welcome
                .navigationDestination(for: Screen.self) { screen in
                    switch screen {
                    case .code: codeScreen
                    case .mfa: mfaScreen
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Server settings", systemImage: "gearshape") { showingServer = true }
                            .labelStyle(.iconOnly).disabled(signingIn)
                    }
                }
        }
        .tint(Theme.heading)
        .sheet(isPresented: $showingServer) { LoginServerSettings() }
        .task(id: savedURL) { await loadProviders() }
        .onChange(of: path) { oldPath, newPath in
            clearFeedback(); focused = nil; codeFocused = false
            if newPath.count < oldPath.count {
                credential = ""
            }
            // Going back from the authenticator step abandons that sign-in.
            if oldPath.last == .mfa, newPath.last != .mfa { session.cancelMfa() }
        }
        // A sign-in that needs the second factor continues on its own screen.
        .onChange(of: session.mfaChallenge?.token) { _, challenge in
            if challenge != nil, path.last != .mfa { path.append(.mfa) }
        }
        .onChange(of: savedURL) {
            path = []; email = ""; credential = ""; usePassword = false
            clearFeedback()
        }
    }

    private var welcome: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 16) {
                        Image("NuphosMark").resizable().scaledToFit().frame(width: 48, height: 48)
                            .accessibilityHidden(true)
                        VStack(spacing: 8) {
                            Text("Welcome to Nuphos").font(.title.bold())
                                .multilineTextAlignment(.center)
                            Text("Sign in or create an account.")
                                .font(.subheadline).foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    }.padding(.top, 24)
                    if !session.savedAccounts.accounts.isEmpty || session.addingAccount || session.savedAccounts.error != nil {
                        SavedAccountsView()
                    }
                    Spacer(minLength: 24)
                    VStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Email address").font(.subheadline.weight(.medium))
                            emailField
                                .padding(.horizontal, 16).frame(minHeight: 52)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        }
                        if usePassword {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Password").font(.subheadline.weight(.medium))
                                SecureField("Password", text: $credential).textContentType(.password)
                                    .focused($focused, equals: .password).submitLabel(.go)
                                    .onSubmit { if canContinue { Task { await signIn(password: true) } } }
                                    .accessibilityIdentifier("login.password-field")
                                    .padding(.horizontal, 16).frame(minHeight: 52)
                                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                            }
                        }
                        Button {
                            focused = nil
                            Task { usePassword ? await signIn(password: true) : await sendCode() }
                        } label: {
                            HStack {
                                if signingIn { ProgressView() }
                                Text(signingIn ? "Please wait…" : usePassword ? "Sign in" : "Continue")
                            }
                            .frame(maxWidth: .infinity, minHeight: 20)
                            .foregroundStyle(canContinue && !signingIn ? loginButtonLabel : Theme.body)
                        }
                        .buttonStyle(LoginPrimaryButtonStyle())
                        .disabled(!canContinue).accessibilityIdentifier("login.submit")
                        if let message = displayedError {
                            Text(message).font(.footnote).foregroundStyle(.red)
                                .accessibilityIdentifier("login.error")
                        }
                        Button(usePassword ? "Use an email code instead" : "Use a password") {
                            usePassword.toggle(); credential = ""; clearFeedback()
                            focused = usePassword ? (validEmail ? .password : .email) : nil
                        }
                        .font(.subheadline).buttonStyle(.plain).foregroundStyle(Theme.body)
                        .frame(minHeight: 44).accessibilityIdentifier("login.password")
                        if !providers.isEmpty {
                            HStack(spacing: 16) {
                                Rectangle().fill(.quaternary).frame(height: 1)
                                Text("or").font(.footnote).foregroundStyle(.secondary).fixedSize()
                                Rectangle().fill(.quaternary).frame(height: 1)
                            }.frame(height: 20).padding(.vertical, 4)
                        }
                        loginOptions
                    }.disabled(signingIn)
                    Text("By continuing, you agree to our [Terms of Service](https://nuphos.ai/terms) and [Privacy Policy](https://nuphos.ai/privacy).")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding(24)
                .frame(maxWidth: 440)
                .frame(minHeight: geometry.size.height)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Theme.canvas)
    }

    private var loginOptions: some View {
        VStack(spacing: 12) {
            if providers.contains(.apple) {
                #if os(iOS)
                NativeAppleSignInButton(dark: colorScheme == .dark) {
                    clearFeedback()
                    Task { await session.signIn(provider: .apple) }
                }
                .id(colorScheme).frame(height: 52)
                #else
                Button("Continue with Apple") { Task { await session.signIn(provider: .apple) } }
                    .buttonStyle(.borderedProminent)
                #endif
            }
            if providers.contains(.google) {
                Button {
                    clearFeedback()
                    Task { await session.signIn(provider: .google) }
                } label: {
                    HStack(spacing: 12) {
                        Image("GoogleSignIn").resizable().renderingMode(.original).scaledToFit().frame(width: 20, height: 20)
                        Text("Continue with Google")
                    }.frame(maxWidth: .infinity, minHeight: 20)
                        .foregroundStyle(loginButtonLabel)
                }
                .buttonStyle(.borderedProminent).accessibilityIdentifier("login.google")
            }
            if providers.contains(.oidc) {
                Button {
                    clearFeedback()
                    Task { await session.signIn(provider: .oidc) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "key.fill").frame(width: 20, height: 20)
                        Text("Continue with \(oidcName)")
                    }.frame(maxWidth: .infinity, minHeight: 20)
                        .foregroundStyle(loginButtonLabel)
                }
                .buttonStyle(.borderedProminent).accessibilityIdentifier("login.oidc")
            }
            if loadingProviders { ProgressView().frame(minHeight: 44) }
            if providerError {
                Button("Retry sign-in options") { Task { await loadProviders() } }
                    .font(.footnote).frame(minHeight: 44)
            }
        }
        .controlSize(.large).buttonBorderShape(.capsule).tint(loginButtonFill).disabled(signingIn)
    }

    private var codeScreen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Check your email")
                        .font(.title.bold()).foregroundStyle(Theme.heading)
                    Text("Enter the 6-digit code sent to").foregroundStyle(Theme.body)
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(cleanEmail).font(.body.weight(.medium)).foregroundStyle(Theme.heading)
                            .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        Button("Change") {
                            credential = ""
                            codeFocused = false; path = []
                        }
                        .font(.subheadline).buttonStyle(.plain).frame(minHeight: 44)
                        .accessibilityLabel("Use a different email")
                        .accessibilityIdentifier("login.change-email")
                    }
                }
                verificationCodeField
                feedback
                VStack(spacing: 0) {
                    Text("Didn't get a code?").font(.footnote).foregroundStyle(Theme.body)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let remaining = max(0, Int(ceil(resendAt.timeIntervalSince(context.date))))
                        if remaining > 0 {
                            Text("Resend code in \(remaining)s").font(.footnote).foregroundStyle(Theme.body)
                                .frame(minHeight: 44)
                        } else {
                            Button("Resend code") { Task { await sendCode() } }
                                .font(.footnote.weight(.semibold)).buttonStyle(.plain).frame(minHeight: 44)
                        }
                    }
                    Text("The code expires in 10 minutes.").font(.footnote).foregroundStyle(Theme.body)
                }.frame(maxWidth: .infinity)
            }
            .padding(24).frame(maxWidth: 440).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(signingIn)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            primaryAction("Sign in", disabled: !validCode) { await signIn(password: false) }
        }
        .disabled(signingIn)
    }

    private var mfaScreen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Two-factor authentication")
                        .font(.title.bold()).foregroundStyle(Theme.heading)
                    Text("Enter the 6-digit code from your authenticator app.").foregroundStyle(Theme.body)
                }
                MfaCodeEntry(submitLabel: "Sign in", submit: { try await session.verifyMfa(code: $0) }, passkey: {
                    guard let challenge = session.mfaChallenge?.token else { return }
                    let options = try await AccountAPI.signInPasskeyOptions(mfaToken: challenge)
                    try await session.verifyMfa(passkey: try await Passkeys.answer(options))
                })
            }
            .padding(24).frame(maxWidth: 440).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
    }

    private var verificationCodeField: some View {
        VerificationCodeInput(text: $credential, isFocused: $codeFocused)
        .frame(height: codeCellHeight)
        .overlay {
            HStack(spacing: 8) {
                ForEach(0..<6) { index in
                    let digits = Array(credential)
                    let active = codeFocused && index == min(digits.count, 5)
                    Text(index < digits.count ? String(digits[index]) : "")
                        .font(.title2.monospacedDigit().weight(.semibold))
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12).strokeBorder(
                                codeBorderColor(active: active),
                                lineWidth: active || error != nil ? 2 : 1
                            )
                        }
                }
            }
            .allowsHitTesting(false).accessibilityHidden(true)
        }
        .onChange(of: credential) {
            if error != nil { clearFeedback() }
            guard path.last == .code, validCode, !signingIn else { return }
            codeFocused = false
            Task { await signIn(password: false) }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled, path.last == .code else { return }
            codeFocused = true
        }
    }

    private func codeBorderColor(active: Bool) -> Color {
        if error != nil { return .red }
        if active { return Theme.heading }
        return Theme.body.opacity(0.35)
    }

    private var emailField: some View {
        TextField("Email address", text: $email).textContentType(.emailAddress).autocorrectionDisabled()
            #if os(iOS)
            .keyboardType(.emailAddress).textInputAutocapitalization(.never)
            #endif
            .focused($focused, equals: .email).submitLabel(.next)
            .onSubmit {
                if usePassword { focused = .password }
                else if validEmail { Task { await sendCode() } }
            }
            .accessibilityIdentifier("login.email")
    }

    @ViewBuilder private var feedback: some View {
        if let error {
            Text(error).font(.subheadline).foregroundStyle(.red).accessibilityIdentifier("login.error")
        }
    }

    private func primaryAction(_ title: String, disabled: Bool, action: @escaping () async -> Void) -> some View {
        Button {
            focused = nil; codeFocused = false
            Task { await action() }
        } label: {
            HStack {
                if signingIn { ProgressView() }
                Text(signingIn ? "Please wait…" : title)
            }.frame(maxWidth: .infinity, minHeight: 20)
                .foregroundStyle(disabled || signingIn ? Theme.body : loginButtonLabel)
        }
        .buttonStyle(LoginPrimaryButtonStyle())
        .disabled(disabled || signingIn).accessibilityIdentifier("login.submit")
        .padding(.horizontal, 24).padding(.vertical, 12).background(Theme.canvas)
    }

    private var displayedError: String? {
        if let error { return error }
        if case .signedOut(let message) = session.state { return message }
        return nil
    }

    private func clearFeedback() {
        error = nil
        session.dismissSignInError()
    }

    private func loadProviders() async {
        let baseURL = NuphosAPI.baseURL
        providers = []; loadingProviders = true; providerError = false
        do {
            let offered = try await NuphosWeb.availableProviders(baseURL: baseURL)
            try Task.checkCancellation()
            guard baseURL == NuphosAPI.baseURL else { return }
            providers = offered.providers
            oidcName = offered.oidcName
        } catch {
            guard !Task.isCancelled, baseURL == NuphosAPI.baseURL else { return }
            providerError = true
        }
        loadingProviders = false
    }

    private func signIn(password: Bool) async {
        guard !signingIn, password ? canContinue : validCode else { return }
        busy = true; clearFeedback()
        defer { busy = false }
        do {
            try await session.emailSignIn(email: cleanEmail, credential: credential, password: password)
        } catch { self.error = error.localizedDescription }
    }

    private func sendCode() async {
        guard !signingIn, validEmail else { return }
        busy = true; clearFeedback()
        defer { busy = false }
        do {
            let _: AccountAPI.OK = try await AccountAPI.request("email/request-code", method: "POST", body: ["email": cleanEmail])
            credential = ""
            resendAt = .now.addingTimeInterval(60)
            if path.last != .code { path.append(.code) }
        } catch { self.error = error.localizedDescription }
    }
}

private struct LoginPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 16).padding(.vertical, 16)
            .foregroundStyle(isEnabled ? (colorScheme == .dark ? Color.black : .white) : Theme.body)
            .background(
                isEnabled ? (colorScheme == .dark ? Color.white : .black) : Color(uiColor: .systemGray5),
                in: Capsule()
            )
            .opacity(configuration.isPressed && isEnabled ? 0.8 : 1)
    }
}

#if os(iOS)
private struct VerificationCodeInput: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.keyboardType = .numberPad
        field.textContentType = .oneTimeCode
        field.textColor = .clear
        field.tintColor = .clear
        field.borderStyle = .none
        field.autocorrectionType = .no
        field.accessibilityLabel = "Verification code"
        field.accessibilityHint = "Enter the six-digit code."
        field.accessibilityIdentifier = "login.code"
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.parent = self
        if field.text != text { field.text = text }
        field.isEnabled = context.environment.isEnabled
        if isFocused && field.isEnabled && field.window != nil && !field.isFirstResponder {
            field.becomeFirstResponder()
        } else if (!isFocused || !field.isEnabled) && field.isFirstResponder {
            field.resignFirstResponder()
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: VerificationCodeInput
        init(_ parent: VerificationCodeInput) { self.parent = parent }

        private func apply(_ value: String, to field: UITextField) {
            let digits = String(value.filter { $0 >= "0" && $0 <= "9" }.prefix(6))
            field.text = digits
            if parent.text != digits { parent.text = digits }
            let end = field.endOfDocument
            field.selectedTextRange = field.textRange(from: end, to: end)
        }

        @objc func changed(_ field: UITextField) { apply(field.text ?? "", to: field) }

        func textField(_ field: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
            let value = (field.text ?? "") as NSString
            guard range.location + range.length <= value.length else { return false }
            let pastedDigits = string.filter { $0 >= "0" && $0 <= "9" }
            apply(pastedDigits.count >= 6 ? string : value.replacingCharacters(in: range, with: string), to: field)
            return false
        }

        func textFieldDidBeginEditing(_ field: UITextField) {
            let end = field.endOfDocument
            field.selectedTextRange = field.textRange(from: end, to: end)
            guard !parent.isFocused else { return }
            DispatchQueue.main.async { self.parent.isFocused = true }
        }

        func textFieldDidEndEditing(_ field: UITextField) {
            guard parent.isFocused else { return }
            DispatchQueue.main.async { self.parent.isFocused = false }
        }
    }
}
#endif

#if os(iOS)
private struct NativeAppleSignInButton: UIViewRepresentable {
    let dark: Bool
    let action: () -> Void

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .continue, style: dark ? .white : .black)
        button.cornerRadius = 26
        button.accessibilityIdentifier = "login.apple"
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {
        uiView.isEnabled = context.environment.isEnabled
    }
}
#endif

private struct LoginServerSettings: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(NuphosAPI.baseURLKey) private var savedURL = ""
    @State private var draft = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://nuphos.example.com", text: $draft)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never)
                        #endif
                } header: {
                    Text("Server address")
                } footer: {
                    Text("Leave this unchanged to use Nuphos Cloud. Enter your server address to use a self-hosted instance.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                if !savedURL.isEmpty {
                    Section {
                        Button("Use Nuphos Cloud") { savedURL = ""; dismiss() }
                    }
                }
            }
            .navigationTitle("Server settings").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { draft = savedURL }
        }.presentationDetents([.medium, .large])
    }

    private func save() {
        guard let url = URL(string: draft.trimmingCharacters(in: .whitespaces)),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host(), !host.isEmpty
        else { error = "Enter a full URL, e.g. https://nuphos.example.com"; return }
        var origin = URLComponents()
        origin.scheme = scheme; origin.host = host; origin.port = url.port
        savedURL = origin.url?.absoluteString ?? ""
        dismiss()
    }
}
