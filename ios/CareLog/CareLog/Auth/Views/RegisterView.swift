//
//  RegisterView.swift
//  CareLog
//
//  Registration view for new relatives (caregivers)
//

import SwiftUI

/// Registration view for new caregivers.
///
/// This is the entry point for onboarding - relatives create their
/// own account first, then onboard a patient.
struct RegisterView: View {
    @StateObject private var viewModel = RegisterViewModel()
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var acceptedTerms = false
    @State private var showPassword = false

    var isFormValid: Bool {
        !name.isEmpty &&
        !email.isEmpty &&
        password.count >= 8 &&
        password == confirmPassword &&
        acceptedTerms
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 8) {
                        Text("Join CareLog as a Caregiver")
                            .font(.title2)
                            .fontWeight(.bold)

                        Text("Create your account to start monitoring your loved one's health")
                            .font(.body)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top)

                    // Form fields
                    VStack(spacing: 16) {
                        // Name field
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Full Name")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            TextField("Enter your name", text: $name)
                                .textContentType(.name)
                                .textInputAutocapitalization(.words)
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(12)
                        }

                        // Email field
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Email")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            TextField("Enter your email", text: $email)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(12)
                        }

                        // Phone field (optional)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Phone Number (Optional)")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            TextField("Enter your phone", text: $phone)
                                .textContentType(.telephoneNumber)
                                .keyboardType(.phonePad)
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(12)
                        }

                        // Password field
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Password")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            HStack {
                                if showPassword {
                                    TextField("Create a password", text: $password)
                                        .textContentType(.newPassword)
                                } else {
                                    SecureField("Create a password", text: $password)
                                        .textContentType(.newPassword)
                                }
                                Button(action: { showPassword.toggle() }) {
                                    Image(systemName: showPassword ? "eye.slash" : "eye")
                                        .foregroundColor(.secondary)
                                }
                            }
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(12)

                            Text("At least 8 characters with uppercase, lowercase, number, and symbol")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        // Confirm password field
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Confirm Password")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            SecureField("Confirm your password", text: $confirmPassword)
                                .textContentType(.newPassword)
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(12)

                            if !confirmPassword.isEmpty && password != confirmPassword {
                                Text("Passwords do not match")
                                    .font(.caption)
                                    .foregroundColor(.red)
                            }
                        }

                        // Terms acceptance
                        Toggle(isOn: $acceptedTerms) {
                            Text("I agree to the Terms of Service and Privacy Policy")
                                .font(.subheadline)
                        }
                        .toggleStyle(CheckboxToggleStyle())
                    }

                    // Error message
                    if let error = viewModel.errorMessage {
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                    }

                    // Register button
                    Button(action: {
                        Task {
                            await viewModel.register(
                                email: email,
                                password: password,
                                name: name,
                                phone: phone.isEmpty ? nil : phone
                            )
                        }
                    }) {
                        if viewModel.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Text("Create Account")
                                .font(.headline)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(isFormValid ? Color.accentColor : Color.gray)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                    .disabled(!isFormValid || viewModel.isLoading)

                    // Login link
                    HStack {
                        Text("Already have an account?")
                            .foregroundColor(.secondary)
                        Button("Sign in") {
                            dismiss()
                        }
                    }
                    .font(.subheadline)
                }
                .padding()
            }
            .navigationTitle("Create Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .navigationDestination(isPresented: $viewModel.needsVerification) {
                VerificationView(email: email)
            }
        }
    }
}

/// Checkbox style toggle for terms acceptance.
struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .top) {
            Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                .foregroundColor(configuration.isOn ? .accentColor : .secondary)
                .font(.title3)
                .onTapGesture {
                    configuration.isOn.toggle()
                }

            configuration.label
        }
    }
}

#Preview {
    RegisterView()
}
