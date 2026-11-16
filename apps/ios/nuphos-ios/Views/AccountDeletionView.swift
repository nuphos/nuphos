import SwiftUI

struct AccountDeletionView: View {
    @Environment(AuthSession.self) private var session
    let user: NuphosUser
    @State private var request: DeletionStatus?
    @State private var confirmation = ""
    @State private var code = ""
    @State private var password = ""
    @State private var usePassword = false
    @State private var busy = false
    @State private var loaded = false
    @State private var sent = false
    @State private var error: String?

    struct DeletionStatus: Decodable { let status: String; let requestedAt: String; let dueAt: String }
    struct Envelope: Decodable { let request: DeletionStatus? }

    var body: some View {
        Form {
            Section {
                Text("Request permanent account deletion").font(.headline)
                Text("We will permanently delete your account and associated personal data within 30 days. Our team will coordinate any workspace ownership and shared-data handling. Records required by law and data jointly held by your team may be retained where necessary.", comment: "Legal text")
                Text("This submits a deletion request; it does not instantly erase your account. You can continue using your account while the request is processed. Signing in again does not cancel the request.", comment: "Legal text")
                Link("Privacy policy", destination: URL(string: "https://nuphos.ai/privacy")!)
            }
            if let request {
                Section("Request received") {
                    LabeledContent("Status", value: request.status == "in_progress" ? String(localized: "In progress") : String(localized: "Requested"))
                    LabeledContent("Complete by", value: String(request.dueAt.prefix(10)))
                    Text("Your request has been saved. You do not need to contact support to start deletion.", comment: "Legal text")
                }
            } else {
                Section("Confirm it is you") {
                    if usePassword {
                        SecureField("Account password", text: $password).textContentType(.password)
                    } else {
                        Text("Send a verification code to \(user.email).")
                        Button(sent ? "Code sent — check your inbox" : "Send verification code") { Task { await sendCode() } }.disabled(busy || sent || !loaded)
                        TextField("Verification code", text: $code).textContentType(.oneTimeCode)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                    }
                    Button(usePassword ? "Confirm with an email code" : "Confirm with my password") {
                        usePassword.toggle(); password = ""; code = ""; error = nil
                    }.disabled(busy)
                    TextField("Type DELETE", text: $confirmation).autocorrectionDisabled()
                    Button("Request permanent deletion", role: .destructive) { Task { await submit() } }
                        .disabled(busy || !loaded || confirmation != "DELETE" || (usePassword ? password.count < 12 : code.count != 6))
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red); Button("Retry") { Task { await load() } } } }
            if busy { ProgressView() }
        }
        .navigationTitle("Delete account")
        .task { await load() }
    }

    private func load() async {
        guard let token = session.token else { return }
        do {
            let result: Envelope = try await AccountAPI.request("account-deletion", token: token)
            request = result.request; loaded = true; error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func sendCode() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let _: AccountAPI.OK = try await AccountAPI.request("email/request-code", method: "POST", body: ["email": user.email])
            sent = true
        } catch { self.error = error.localizedDescription }
    }

    private func submit() async {
        guard let token = session.token else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let result: Envelope = try await AccountAPI.request("account-deletion", method: "POST", token: token, body: ["confirmation": confirmation, usePassword ? "password" : "code": usePassword ? password : code])
            request = result.request
        } catch { self.error = error.localizedDescription; sent = false }
    }
}
