//
//  VerificationView.swift
//  CareLog
//
//  Email verification view
//

import SwiftUI

/// Email verification view.
///
/// User enters the verification code sent to their email.
struct VerificationView: View {
    let email: String

    @StateObject private var viewModel = VerificationViewModel()
    @Environment(\.dismiss) private var dismiss

    @State private var code = ""
    @FocusState private var isCodeFocused: Bool

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Icon
            Image(systemName: "envelope.badge")
                .font(.system(size: 60))
                .foregroundColor(.accentColor)

            // Header
            VStack(spacing: 8) {
                Text("Check your email")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("We've sent a verification code to")
                    .foregroundColor(.secondary)

                Text(email)
                    .fontWeight(.medium)
            }
            .multilineTextAlignment(.center)

            // Code input
            VStack(spacing: 8) {
                TextField("Enter code", text: $code)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.title)
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .focused($isCodeFocused)
                    .onChange(of: code) { newValue in
                        // Limit to 6 characters
                        if newValue.count > 6 {
                            code = String(newValue.prefix(6))
                        }
                    }

                Text("Enter the 6-digit code")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)

            // Error message
            if let error = viewModel.errorMessage {
                Text(error)
                    .font(.subheadline)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            // Verify button
            Button(action: {
                Task {
                    await viewModel.verify(email: email, code: code)
                }
            }) {
                if viewModel.isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Text("Verify")
                        .font(.headline)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(code.count == 6 ? Color.accentColor : Color.gray)
            .foregroundColor(.white)
            .cornerRadius(12)
            .disabled(code.count != 6 || viewModel.isLoading)
            .padding(.horizontal)

            // Resend code
            Button("Resend verification code") {
                Task {
                    await viewModel.resendCode(email: email)
                }
            }
            .font(.subheadline)
            .disabled(viewModel.isLoading)

            Spacer()
        }
        .padding()
        .navigationTitle("Verify Email")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            isCodeFocused = true
        }
        .onChange(of: viewModel.isVerified) { isVerified in
            if isVerified {
                dismiss()
            }
        }
    }
}

/// ViewModel for verification screen.
@MainActor
class VerificationViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var isVerified = false
    @Published var codeResent = false

    private let authService: AuthService

    init(authService: AuthService = .shared) {
        self.authService = authService
    }

    /// Verify the email with the code.
    func verify(email: String, code: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await authService.confirmSignUp(email: email, code: code)
            isVerified = true
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    /// Resend the verification code.
    func resendCode(email: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await authService.resendConfirmationCode(email: email)
            codeResent = true
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

#Preview {
    NavigationStack {
        VerificationView(email: "test@example.com")
    }
}
