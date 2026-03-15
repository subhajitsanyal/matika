//
//  PatientOnboardingView.swift
//  CareLog
//
//  Patient onboarding screen for relatives to create patient accounts
//

import SwiftUI

/// Patient onboarding view.
///
/// Allows relatives to create a patient account by entering
/// the patient's details. Designed for accessibility with
/// large touch targets and clear labels.
struct PatientOnboardingView: View {
    @StateObject private var viewModel: PatientOnboardingViewModel
    @Environment(\.dismiss) private var dismiss

    // Form state
    @State private var name = ""
    @State private var dateOfBirth = ""
    @State private var selectedGender: PatientGender?
    @State private var selectedBloodType: BloodType?
    @State private var medicalConditions = ""
    @State private var allergies = ""
    @State private var medications = ""
    @State private var emergencyContactName = ""
    @State private var emergencyContactPhone = ""

    let onPatientCreated: (String) -> Void

    init(
        patientService: PatientService,
        onPatientCreated: @escaping (String) -> Void
    ) {
        _viewModel = StateObject(wrappedValue: PatientOnboardingViewModel(patientService: patientService))
        self.onPatientCreated = onPatientCreated
    }

    var isFormValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    headerSection

                    // Patient Details Section
                    patientDetailsSection

                    // Medical Info Section
                    medicalInfoSection

                    // Emergency Contact Section
                    emergencyContactSection

                    // Error Message
                    if let error = viewModel.errorMessage {
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    // Create Button
                    createButton
                }
                .padding()
            }
            .navigationTitle("Add Patient")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onChange(of: viewModel.isSuccess) { _, isSuccess in
                if isSuccess, let patientId = viewModel.createdPatientId {
                    onPatientCreated(patientId)
                }
            }
        }
    }

    // MARK: - View Components

    private var headerSection: some View {
        VStack(spacing: 8) {
            Text("Enter Patient Details")
                .font(.title2)
                .fontWeight(.bold)

            Text("Create an account for your loved one")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top)
    }

    private var patientDetailsSection: some View {
        VStack(spacing: 16) {
            // Name (Required)
            FormTextField(
                label: "Patient's Full Name *",
                placeholder: "Enter patient's name",
                text: $name,
                icon: "person.fill",
                contentType: .name,
                capitalization: .words
            )

            // Date of Birth
            FormTextField(
                label: "Date of Birth",
                placeholder: "DD/MM/YYYY",
                text: $dateOfBirth,
                icon: "calendar",
                keyboardType: .numbersAndPunctuation
            )

            // Gender
            FormPicker(
                label: "Gender",
                icon: "person.fill",
                selection: $selectedGender,
                options: PatientGender.allCases,
                displayText: { $0?.rawValue ?? "Select gender" }
            )

            // Blood Type
            FormPicker(
                label: "Blood Type",
                icon: "drop.fill",
                selection: $selectedBloodType,
                options: BloodType.allCases,
                displayText: { $0?.rawValue ?? "Select blood type" }
            )
        }
    }

    private var medicalInfoSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Medical Information")
                .font(.headline)
                .padding(.top, 8)

            // Medical Conditions
            FormTextArea(
                label: "Medical Conditions",
                placeholder: "E.g., Diabetes, Hypertension",
                text: $medicalConditions,
                icon: "stethoscope",
                hint: "Separate multiple conditions with commas"
            )

            // Allergies
            FormTextArea(
                label: "Allergies",
                placeholder: "E.g., Penicillin, Peanuts",
                text: $allergies,
                icon: "exclamationmark.triangle.fill",
                hint: "Separate multiple allergies with commas"
            )

            // Current Medications
            FormTextArea(
                label: "Current Medications",
                placeholder: "E.g., Metformin 500mg, Lisinopril 10mg",
                text: $medications,
                icon: "pills.fill",
                hint: "Separate multiple medications with commas"
            )
        }
    }

    private var emergencyContactSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Emergency Contact")
                .font(.headline)
                .padding(.top, 8)

            FormTextField(
                label: "Contact Name",
                placeholder: "Enter contact name",
                text: $emergencyContactName,
                icon: "person.fill",
                contentType: .name,
                capitalization: .words
            )

            FormTextField(
                label: "Contact Phone",
                placeholder: "Enter phone number",
                text: $emergencyContactPhone,
                icon: "phone.fill",
                contentType: .telephoneNumber,
                keyboardType: .phonePad
            )
        }
    }

    private var createButton: some View {
        Button(action: createPatient) {
            if viewModel.isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
            } else {
                Text("Create Patient Account")
                    .font(.headline)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 56)
        .background(isFormValid ? Color.accentColor : Color.gray)
        .foregroundColor(.white)
        .cornerRadius(12)
        .disabled(!isFormValid || viewModel.isLoading)
        .padding(.top, 8)
    }

    // MARK: - Actions

    private func createPatient() {
        Task {
            await viewModel.createPatient(
                name: name,
                dateOfBirth: dateOfBirth.isEmpty ? nil : dateOfBirth,
                gender: selectedGender?.rawValue,
                bloodType: selectedBloodType?.rawValue,
                medicalConditions: medicalConditions,
                allergies: allergies,
                medications: medications,
                emergencyContactName: emergencyContactName,
                emergencyContactPhone: emergencyContactPhone
            )
        }
    }
}

// MARK: - Form Components

/// Reusable text field with label and icon.
struct FormTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var icon: String? = nil
    var contentType: UITextContentType? = nil
    var keyboardType: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .never

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)

            HStack {
                if let icon = icon {
                    Image(systemName: icon)
                        .foregroundColor(.secondary)
                        .frame(width: 24)
                }

                TextField(placeholder, text: $text)
                    .textContentType(contentType)
                    .keyboardType(keyboardType)
                    .textInputAutocapitalization(capitalization)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)
        }
    }
}

/// Reusable text area for multi-line input.
struct FormTextArea: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var icon: String? = nil
    var hint: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)

            HStack(alignment: .top) {
                if let icon = icon {
                    Image(systemName: icon)
                        .foregroundColor(.secondary)
                        .frame(width: 24)
                        .padding(.top, 12)
                }

                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(2...4)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)

            if let hint = hint {
                Text(hint)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}

/// Reusable picker with label and icon.
struct FormPicker<T: Hashable & Identifiable>: View {
    let label: String
    var icon: String? = nil
    @Binding var selection: T?
    let options: [T]
    let displayText: (T?) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Menu {
                Button("None") {
                    selection = nil
                }
                ForEach(options) { option in
                    Button(displayText(option)) {
                        selection = option
                    }
                }
            } label: {
                HStack {
                    if let icon = icon {
                        Image(systemName: icon)
                            .foregroundColor(.secondary)
                            .frame(width: 24)
                    }

                    Text(displayText(selection))
                        .foregroundColor(selection == nil ? .secondary : .primary)

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
}

#Preview {
    PatientOnboardingView(
        patientService: PatientService(authService: AuthService()),
        onPatientCreated: { _ in }
    )
}
