import SwiftUI

/// Attendant login view for logging in on a patient's device.
struct AttendantLoginView: View {
    @StateObject private var viewModel = AttendantLoginViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Info text
                Text("Log in with your attendant credentials to record vitals on behalf of the patient.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Spacer().frame(height: 16)

                // Email field
                VStack(alignment: .leading, spacing: 8) {
                    Text("Email")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    TextField("Email", text: $viewModel.email)
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                        .disabled(viewModel.isLoading)
                }

                // Password field
                VStack(alignment: .leading, spacing: 8) {
                    Text("Password")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    SecureField("Password", text: $viewModel.password)
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.password)
                        .disabled(viewModel.isLoading)
                }

                // Error message
                if let error = viewModel.error {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                }

                Spacer().frame(height: 8)

                // Login button
                Button(action: {
                    viewModel.login()
                }) {
                    if viewModel.isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                    } else {
                        Text("Log In as Attendant")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                    }
                }
                .background(CareLogColors.primary)
                .foregroundColor(.white)
                .cornerRadius(10)
                .disabled(viewModel.email.isEmpty || viewModel.password.isEmpty || viewModel.isLoading)

                Spacer()

                // Session info
                Text("Your session will be active for 8 hours. You can switch back to patient mode at any time.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(8)
            }
            .padding(24)
            .navigationTitle("Attendant Login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onChange(of: viewModel.loginSuccess) { _, success in
                if success {
                    dismiss()
                }
            }
        }
    }
}

// MARK: - ViewModel

@MainActor
class AttendantLoginViewModel: ObservableObject {
    @Published var email = ""
    @Published var password = ""
    @Published var isLoading = false
    @Published var error: String?
    @Published var loginSuccess = false

    private let sessionManager = AttendantSessionManager.shared

    func login() {
        guard !email.isEmpty, !password.isEmpty else { return }

        isLoading = true
        error = nil

        Task {
            do {
                _ = try await sessionManager.loginAsAttendant(email: email, password: password)
                loginSuccess = true
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}

// MARK: - Preview

#Preview {
    AttendantLoginView()
}
