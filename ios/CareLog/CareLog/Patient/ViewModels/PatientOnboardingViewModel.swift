//
//  PatientOnboardingViewModel.swift
//  CareLog
//
//  ViewModel for patient onboarding screen
//

import Foundation
import SwiftUI

/// ViewModel for patient onboarding.
///
/// Manages the state for creating a new patient account,
/// including form validation and API calls.
@MainActor
class PatientOnboardingViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var createdPatientId: String?
    @Published var isSuccess = false

    private let patientService: PatientService

    init(patientService: PatientService) {
        self.patientService = patientService
    }

    /// Create a new patient account.
    ///
    /// - Parameters:
    ///   - name: Patient's full name (required)
    ///   - dateOfBirth: Date of birth in DD/MM/YYYY format
    ///   - gender: Patient's gender
    ///   - bloodType: Blood type
    ///   - medicalConditions: Comma-separated list of conditions
    ///   - allergies: Comma-separated list of allergies
    ///   - medications: Comma-separated list of current medications
    ///   - emergencyContactName: Emergency contact's name
    ///   - emergencyContactPhone: Emergency contact's phone
    func createPatient(
        name: String,
        dateOfBirth: String?,
        gender: String?,
        bloodType: String?,
        medicalConditions: String,
        allergies: String,
        medications: String,
        emergencyContactName: String?,
        emergencyContactPhone: String?
    ) async {
        guard !name.isEmpty else {
            errorMessage = "Patient name is required"
            return
        }

        isLoading = true
        errorMessage = nil

        let request = CreatePatientRequest(
            name: name,
            dateOfBirth: formatDateForAPI(dateOfBirth),
            gender: gender,
            bloodType: bloodType,
            medicalConditions: parseCommaList(medicalConditions),
            allergies: parseCommaList(allergies),
            medications: parseCommaList(medications),
            emergencyContactName: emergencyContactName?.isEmpty == true ? nil : emergencyContactName,
            emergencyContactPhone: emergencyContactPhone?.isEmpty == true ? nil : emergencyContactPhone
        )

        do {
            let patientId = try await patientService.createPatient(request: request)
            createdPatientId = patientId
            isSuccess = true
            print("Patient created successfully: \(patientId)")
        } catch {
            errorMessage = error.localizedDescription
            print("Failed to create patient: \(error)")
        }

        isLoading = false
    }

    /// Parse a comma-separated string into an array.
    private func parseCommaList(_ text: String) -> [String] {
        text.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// Convert DD/MM/YYYY to ISO format for API.
    private func formatDateForAPI(_ dateString: String?) -> String? {
        guard let dateString = dateString, !dateString.isEmpty else {
            return nil
        }

        let parts = dateString.split(separator: "/")
        guard parts.count == 3,
              let day = Int(parts[0]),
              let month = Int(parts[1]),
              let year = Int(parts[2]) else {
            return nil
        }

        return String(format: "%04d-%02d-%02d", year, month, day)
    }
}
