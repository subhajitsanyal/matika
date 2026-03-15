//
//  InviteDoctorViewModel.swift
//  CareLog
//
//  ViewModel for doctor invite screen
//

import Foundation
import SwiftUI

/// ViewModel for doctor invite screen.
@MainActor
class InviteDoctorViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var isSuccess = false
    @Published var inviteId: String?
    @Published var expiresAt: String?

    private let inviteService: InviteService

    init(inviteService: InviteService) {
        self.inviteService = inviteService
    }

    /// Send a doctor invite.
    func sendInvite(
        patientId: String,
        doctorName: String,
        doctorEmail: String,
        specialty: String?
    ) async {
        guard !doctorName.isEmpty else {
            errorMessage = "Doctor name is required"
            return
        }

        guard !doctorEmail.isEmpty else {
            errorMessage = "Doctor email is required"
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let response = try await inviteService.sendDoctorInvite(
                patientId: patientId,
                doctorName: doctorName,
                doctorEmail: doctorEmail,
                specialty: specialty?.isEmpty == true ? nil : specialty
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
