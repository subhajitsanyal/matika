import SwiftUI

/// Care team management view showing attendants, doctors, and relatives.
struct CareTeamView: View {
    @StateObject private var viewModel = CareTeamViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var showInviteSheet = false
    @State private var preselectedRole: String?

    var body: some View {
        NavigationStack {
            ZStack {
                if viewModel.isLoading {
                    ProgressView("Loading care team...")
                } else if let error = viewModel.error {
                    ErrorView(message: error) {
                        viewModel.loadCareTeam()
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 24) {
                            // Doctors section
                            if let doctors = viewModel.careTeam?.doctors, !doctors.isEmpty {
                                SectionView(
                                    title: "Doctors",
                                    icon: "stethoscope",
                                    members: doctors,
                                    roleColor: CareLogColors.primary
                                )
                            }

                            // Attendants section
                            SectionView(
                                title: "Attendants",
                                icon: "person.fill",
                                members: viewModel.careTeam?.attendants ?? [],
                                roleColor: CareLogColors.success,
                                emptyMessage: "No attendants yet. Invite someone to help care for the patient.",
                                onAdd: {
                                    preselectedRole = "attendant"
                                    showInviteSheet = true
                                }
                            )

                            // Family members section
                            if let relatives = viewModel.careTeam?.relatives, !relatives.isEmpty {
                                SectionView(
                                    title: "Family Members",
                                    icon: "person.2.fill",
                                    members: relatives,
                                    roleColor: CareLogColors.warning
                                )
                            }

                            // Pending invites section
                            if let invites = viewModel.careTeam?.pendingInvites, !invites.isEmpty {
                                PendingInvitesSection(
                                    invites: invites,
                                    onResend: { viewModel.resendInvite(id: $0) },
                                    onCancel: { viewModel.cancelInvite(id: $0) }
                                )
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Care Team")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showInviteSheet = true
                    } label: {
                        Image(systemName: "person.badge.plus")
                    }
                }
            }
            .sheet(isPresented: $showInviteSheet) {
                InviteSheet(
                    preselectedRole: preselectedRole,
                    onInvite: { email, name, role in
                        viewModel.sendInvite(email: email, name: name, role: role)
                    }
                )
                .presentationDetents([.medium])
            }
            .task {
                viewModel.loadCareTeam()
            }
            .onChange(of: showInviteSheet) { _, isShowing in
                if !isShowing {
                    preselectedRole = nil
                }
            }
        }
    }
}

// MARK: - Section View

private struct SectionView: View {
    let title: String
    let icon: String
    let members: [CareTeamMember]
    let roleColor: Color
    var emptyMessage: String?
    var onAdd: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Image(systemName: icon)
                    .foregroundColor(.secondary)

                Text(title)
                    .font(.headline)

                Text("\(members.count)")
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.systemGray5))
                    .cornerRadius(8)

                Spacer()

                if let onAdd = onAdd {
                    Button(action: onAdd) {
                        Image(systemName: "plus")
                            .foregroundColor(CareLogColors.primary)
                    }
                }
            }

            if members.isEmpty {
                if let emptyMessage = emptyMessage {
                    Text(emptyMessage)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(12)
                }
            } else {
                ForEach(members) { member in
                    CareTeamMemberRow(member: member, roleColor: roleColor)
                }
            }
        }
    }
}

// MARK: - Care Team Member Row

private struct CareTeamMemberRow: View {
    let member: CareTeamMember
    let roleColor: Color

    var body: some View {
        HStack(spacing: 12) {
            // Avatar
            ZStack {
                Circle()
                    .fill(roleColor.opacity(0.1))
                    .frame(width: 48, height: 48)

                Text(member.name.prefix(2).uppercased())
                    .font(.headline)
                    .foregroundColor(roleColor)
            }

            // Info
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name)
                    .font(.subheadline)
                    .fontWeight(.medium)

                if let email = member.email {
                    Text(email)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                if let joinedAt = member.joinedAt {
                    Text("Joined \(formattedDate(joinedAt))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Role badge
            Text(member.role.capitalized)
                .font(.caption)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(roleColor.opacity(0.1))
                .foregroundColor(roleColor)
                .cornerRadius(12)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.03), radius: 4, y: 2)
    }

    private func formattedDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }
}

// MARK: - Pending Invites Section

private struct PendingInvitesSection: View {
    let invites: [PendingInvite]
    let onResend: (String) -> Void
    let onCancel: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Image(systemName: "clock")
                    .foregroundColor(.secondary)

                Text("Pending Invitations")
                    .font(.headline)

                Text("\(invites.count)")
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.systemGray5))
                    .cornerRadius(8)
            }

            ForEach(invites) { invite in
                PendingInviteRow(
                    invite: invite,
                    onResend: { onResend(invite.id) },
                    onCancel: { onCancel(invite.id) }
                )
            }
        }
    }
}

// MARK: - Pending Invite Row

private struct PendingInviteRow: View {
    let invite: PendingInvite
    let onResend: () -> Void
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Icon
            ZStack {
                Circle()
                    .fill(Color(.systemGray5))
                    .frame(width: 48, height: 48)

                Image(systemName: "envelope")
                    .foregroundColor(.secondary)
            }

            // Info
            VStack(alignment: .leading, spacing: 2) {
                Text(invite.email)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text("Invited as \(invite.role)")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text("Sent \(formattedDate(invite.sentAt))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Actions
            HStack(spacing: 8) {
                Button(action: onResend) {
                    Image(systemName: "arrow.clockwise")
                        .foregroundColor(CareLogColors.primary)
                }

                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundColor(.red)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func formattedDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }
}

// MARK: - Invite Sheet

private struct InviteSheet: View {
    let preselectedRole: String?
    let onInvite: (String, String, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var selectedRole = "attendant"

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .textContentType(.name)

                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                }

                Section("Role") {
                    Picker("Role", selection: $selectedRole) {
                        Text("Attendant").tag("attendant")
                        Text("Doctor").tag("doctor")
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle("Invite to Care Team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Send Invite") {
                        onInvite(email, name, selectedRole)
                        dismiss()
                    }
                    .disabled(name.isEmpty || email.isEmpty)
                }
            }
            .onAppear {
                if let role = preselectedRole {
                    selectedRole = role
                }
            }
        }
    }
}

// MARK: - Error View

private struct ErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text(message)
                .font(.headline)
                .multilineTextAlignment(.center)

            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }
}

// MARK: - Preview

#Preview {
    CareTeamView()
}
