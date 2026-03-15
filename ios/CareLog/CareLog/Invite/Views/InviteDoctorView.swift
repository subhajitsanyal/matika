//
//  InviteDoctorView.swift
//  CareLog
//
//  View for inviting a doctor to access patient health data
//

import SwiftUI

/// Invite doctor view.
///
/// Allows relatives to invite a physician via email.
/// Doctors access patient data through the web portal.
struct InviteDoctorView: View {
    @StateObject private var viewModel: InviteDoctorViewModel
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let patientName: String
    let onInviteSent: () -> Void

    // Form state
    @State private var doctorName = ""
    @State private var doctorEmail = ""
    @State private var selectedSpecialty: DoctorSpecialty?
    @State private var showSuccessAlert = false

    init(
        inviteService: InviteService,
        patientId: String,
        patientName: String,
        onInviteSent: @escaping () -> Void
    ) {
        _viewModel = StateObject(wrappedValue: InviteDoctorViewModel(inviteService: inviteService))
        self.patientId = patientId
        self.patientName = patientName
        self.onInviteSent = onInviteSent
    }

    var isFormValid: Bool {
        !doctorName.trimmingCharacters(in: .whitespaces).isEmpty &&
        !doctorEmail.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    headerSection

                    // Info Card
                    infoCard

                    // Doctor Details
                    doctorDetailsSection

                    // Specialty Picker
                    specialtySection

                    // Permissions Info
                    permissionsCard

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
            .navigationTitle("Invite Doctor")
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
                Text("We've sent an invitation to Dr. \(doctorName). They will receive instructions to create their account and access \(patientName)'s health data through our physician portal.")
            }
        }
    }

    // MARK: - View Components

    private var headerSection: some View {
        VStack(spacing: 8) {
            Text("Add a Physician")
                .font(.title2)
                .fontWeight(.bold)

            Text("Invite \(patientName)'s doctor to review health data")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var infoCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "cross.case.fill")
                .foregroundColor(.blue)
                .font(.title3)

            Text("Doctors access patient data through our secure web portal. They can view vitals, set health thresholds, and receive alerts.")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color.blue.opacity(0.1))
        .cornerRadius(12)
    }

    private var doctorDetailsSection: some View {
        VStack(spacing: 16) {
            FormTextField(
                label: "Doctor's Name *",
                placeholder: "Dr. John Smith",
                text: $doctorName,
                icon: "person.fill",
                contentType: .name,
                capitalization: .words
            )

            FormTextField(
                label: "Email Address *",
                placeholder: "doctor@example.com",
                text: $doctorEmail,
                icon: "envelope.fill",
                contentType: .emailAddress,
                keyboardType: .emailAddress
            )
        }
    }

    private var specialtySection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Specialty (Optional)")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Menu {
                Button("None") {
                    selectedSpecialty = nil
                }
                ForEach(DoctorSpecialty.allCases) { specialty in
                    Button(specialty.rawValue) {
                        selectedSpecialty = specialty
                    }
                }
            } label: {
                HStack {
                    Image(systemName: "stethoscope")
                        .foregroundColor(.secondary)
                        .frame(width: 24)

                    Text(selectedSpecialty?.rawValue ?? "Select specialty")
                        .foregroundColor(selectedSpecialty == nil ? .secondary : .primary)

                    Spacer()

                    Image(systemName: "chevron.down")
                        .foregroundColor(.secondary)
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
            }
        }
    }

    private var permissionsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Physician Permissions")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                PermissionRow(icon: "eye.fill", text: "View all health history")
                PermissionRow(icon: "slider.horizontal.3", text: "Configure alert thresholds")
                PermissionRow(icon: "bell.fill", text: "Receive health alerts")
                PermissionRow(icon: "doc.text.fill", text: "Access medical documents")
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
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
                doctorName: doctorName,
                doctorEmail: doctorEmail,
                specialty: selectedSpecialty?.rawValue
            )
        }
    }
}

// MARK: - Supporting Views

struct PermissionRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundColor(.accentColor)
                .frame(width: 20)
            Text(text)
                .font(.subheadline)
        }
    }
}

// MARK: - Doctor Specialty

enum DoctorSpecialty: String, CaseIterable, Identifiable {
    case generalPractitioner = "General Practitioner"
    case internalMedicine = "Internal Medicine"
    case cardiology = "Cardiology"
    case endocrinology = "Endocrinology"
    case geriatrics = "Geriatrics"
    case neurology = "Neurology"
    case pulmonology = "Pulmonology"
    case nephrology = "Nephrology"
    case other = "Other"

    var id: String { rawValue }
}

#Preview {
    InviteDoctorView(
        inviteService: InviteService(authService: AuthService()),
        patientId: "CL-ABC123",
        patientName: "John Doe",
        onInviteSent: {}
    )
}
