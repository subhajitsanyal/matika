//
//  InviteAttendantView.swift
//  CareLog
//
//  View for inviting an attendant to care for a patient
//

import SwiftUI

/// Invite attendant view.
///
/// Allows relatives to send invites to attendants via email or SMS.
struct InviteAttendantView: View {
    @StateObject private var viewModel: InviteAttendantViewModel
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let patientName: String
    let onInviteSent: () -> Void

    // Form state
    @State private var attendantName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var useEmail = true
    @State private var showSuccessAlert = false

    init(
        inviteService: InviteService,
        patientId: String,
        patientName: String,
        onInviteSent: @escaping () -> Void
    ) {
        _viewModel = StateObject(wrappedValue: InviteAttendantViewModel(inviteService: inviteService))
        self.patientId = patientId
        self.patientName = patientName
        self.onInviteSent = onInviteSent
    }

    var isFormValid: Bool {
        !attendantName.trimmingCharacters(in: .whitespaces).isEmpty &&
        (useEmail ? !email.isEmpty : !phone.isEmpty)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    headerSection

                    // Info Card
                    infoCard

                    // Attendant Name
                    FormTextField(
                        label: "Attendant's Name *",
                        placeholder: "Enter name",
                        text: $attendantName,
                        icon: "person.fill",
                        contentType: .name,
                        capitalization: .words
                    )

                    // Contact Method Selection
                    contactMethodSection

                    // Contact Input
                    contactInputSection

                    // Error Message
                    if let error = viewModel.errorMessage {
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                    }

                    // Send Button
                    sendButton
                }
                .padding()
            }
            .navigationTitle("Invite Attendant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onChange(of: viewModel.isSuccess) { _, isSuccess in
                if isSuccess {
                    showSuccessAlert = true
                }
            }
            .alert("Invitation Sent!", isPresented: $showSuccessAlert) {
                Button("Done") {
                    onInviteSent()
                }
            } message: {
                Text("We've sent an invitation to \(attendantName). They will receive instructions to create their account and start caring for \(patientName).")
            }
        }
    }

    // MARK: - View Components

    private var headerSection: some View {
        VStack(spacing: 8) {
            Text("Add a Caregiver")
                .font(.title2)
                .fontWeight(.bold)

            Text("Invite someone to help care for \(patientName)")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var infoCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "info.circle.fill")
                .foregroundColor(.blue)
                .font(.title3)

            Text("The attendant will receive an invitation to create their account. Once accepted, they can log vitals and help monitor health.")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color.blue.opacity(0.1))
        .cornerRadius(12)
    }

    private var contactMethodSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("How would you like to send the invite?")
                .font(.subheadline)
                .foregroundColor(.secondary)

            HStack(spacing: 12) {
                ContactMethodButton(
                    title: "Email",
                    icon: "envelope.fill",
                    isSelected: useEmail,
                    action: { useEmail = true }
                )

                ContactMethodButton(
                    title: "SMS",
                    icon: "message.fill",
                    isSelected: !useEmail,
                    action: { useEmail = false }
                )
            }
        }
    }

    private var contactInputSection: some View {
        Group {
            if useEmail {
                FormTextField(
                    label: "Email Address *",
                    placeholder: "Enter email",
                    text: $email,
                    icon: "envelope.fill",
                    contentType: .emailAddress,
                    keyboardType: .emailAddress
                )
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    FormTextField(
                        label: "Phone Number *",
                        placeholder: "Enter phone number",
                        text: $phone,
                        icon: "phone.fill",
                        contentType: .telephoneNumber,
                        keyboardType: .phonePad
                    )
                    Text("Include country code (e.g., +91)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.leading, 4)
                }
            }
        }
    }

    private var sendButton: some View {
        Button(action: sendInvite) {
            if viewModel.isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
            } else {
                HStack {
                    Image(systemName: "paperplane.fill")
                    Text("Send Invitation")
                        .font(.headline)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 56)
        .background(isFormValid ? Color.accentColor : Color.gray)
        .foregroundColor(.white)
        .cornerRadius(12)
        .disabled(!isFormValid || viewModel.isLoading)
    }

    // MARK: - Actions

    private func sendInvite() {
        Task {
            await viewModel.sendInvite(
                patientId: patientId,
                attendantName: attendantName,
                email: useEmail ? email : nil,
                phone: useEmail ? nil : phone
            )
        }
    }
}

// MARK: - Supporting Views

struct ContactMethodButton: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(isSelected ? Color.accentColor : Color(.systemGray5))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(10)
        }
    }
}

#Preview {
    InviteAttendantView(
        inviteService: InviteService(authService: AuthService()),
        patientId: "CL-ABC123",
        patientName: "John Doe",
        onInviteSent: {}
    )
}
