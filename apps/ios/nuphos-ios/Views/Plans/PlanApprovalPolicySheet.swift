import SwiftUI

/// The desktop `PlanApprovalPolicyModal`: who has to approve a plan before
/// the agent may run it. The requester always counts; the choice is how
/// many other members must join them.
struct PlanApprovalPolicySheet: View {
    @Environment(PlansStore.self) private var plans
    @Environment(\.dismiss) private var dismiss

    enum Mode: Hashable { case requester, oneOther, quorum }

    @State private var mode: Mode = .requester
    @State private var quorum = 2
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Approvers", selection: $mode) {
                        Text("Requester only").tag(Mode.requester)
                        Text("Requester + one other member").tag(Mode.oneOther)
                        Text("Requester + a quorum").tag(Mode.quorum)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()

                    if mode == .quorum {
                        Stepper("Other members required: \(quorum)", value: $quorum, in: 2...50)
                    }
                } footer: {
                    Text("Changing the policy invalidates approvals on open plans — they must be reviewed again.")
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Plan approval")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving)
                }
            }
            .onAppear {
                let minimum = plans.approvalPolicy?.minimumOtherApprovals ?? 0
                mode = minimum == 0 ? .requester : minimum == 1 ? .oneOther : .quorum
                quorum = max(2, minimum)
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let minimum = switch mode {
        case .requester: 0
        case .oneOther: 1
        case .quorum: quorum
        }
        do {
            try await plans.updateApprovalPolicy(minimumOtherApprovals: minimum)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
