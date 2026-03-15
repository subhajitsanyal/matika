//
//  InviteAttendantViewModel.swift
//  CareLog
//
//  ViewModel for attendant invite screen
//

import Foundation
import SwiftUI

/// ViewModel for attendant invite screen.
@MainActor
class InviteAttendantViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var isSuccess = false
    @Published var inviteId: String?
    @Published var expiresAt: String?

    private let inviteService: InviteService

    init(inviteService: InviteService) {
        self.inviteService = inviteService
    }

    /// Send an attendant invite.
    func sendInvite(
        patientId: String,
        attendantName: String,
        email: String?,
        phone: String?
    ) async {
        guard !attendantName.isEmpty else {
            errorMessage = "Attendant name is required"
            return
        }

        guard email != nil || phone != nil else {
            errorMessage = "Please provide an email or phone number"
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let response = try await inviteService.sendAttendantInvite(
                patientId: patientId,
                attendantName: attendantName,
                email: email?.isEmpty == true ? nil : email,
                phone: phone?.isEmpty == true ? nil : phone
            )

            inviteId = response.inviteId
            expiresAt = response.expiresAt
            isSuccess = true
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    /// Reset the state for a new invite.
    func reset() {
        isLoading = false
        errorMessage = nil
        isSuccess = false
        inviteId = nil
        expiresAt = nil
    }
}
