//
//  RegisterViewModel.swift
//  CareLog
//
//  ViewModel for registration flow
//

import Foundation
import SwiftUI

/// ViewModel for the registration screen.
@MainActor
class RegisterViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var needsVerification = false

    private let authService: AuthService

    init(authService: AuthService = .shared) {
        self.authService = authService
    }

    /// Register a new user (relative/caregiver).
    func register(
        email: String,
        password: String,
        name: String,
        phone: String?
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            let isComplete = try await authService.signUp(
                email: email,
                password: password,
                name: name,
                personaType: .relative
            )

            if isComplete {
                // Already verified (unlikely but possible)
                needsVerification = false
            } else {
                // Needs email verification
                needsVerification = true
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}
