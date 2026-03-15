//
//  PatientService.swift
//  CareLog
//
//  Service for patient-related API calls
//

import Foundation

/// Service for patient management operations.
///
/// Handles:
/// - Creating new patient accounts
/// - Fetching patient details
/// - Managing patient relationships
@MainActor
class PatientService: ObservableObject {
    private let baseURL: String
    private let authService: AuthService

    init(authService: AuthService) {
        self.authService = authService
        self.baseURL = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
            ?? "https://api.carelog.com"
    }

    /// Create a new patient account.
    ///
    /// This creates:
    /// 1. A Cognito user for the patient
    /// 2. A patient record in the database
    /// 3. A persona_link between the relative and patient
    /// 4. A FHIR Patient resource in HealthLake
    ///
    /// - Parameter request: The patient creation request
    /// - Returns: The patient ID (format: CL-XXXXXX)
    func createPatient(request: CreatePatientRequest) async throws -> String {
        let token = try await authService.getAccessToken()

        guard let url = URL(string: "\(baseURL)/patients") else {
            throw PatientServiceError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let encoder = JSONEncoder()
        urlRequest.httpBody = try encoder.encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw PatientServiceError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200...299:
            let decoder = JSONDecoder()
            let createResponse = try decoder.decode(CreatePatientResponse.self, from: data)
            return createResponse.patientId

        case 400:
            throw PatientServiceError.badRequest(parseErrorMessage(from: data))

        case 401:
            throw PatientServiceError.unauthorized

        case 403:
            throw PatientServiceError.forbidden

        case 500...599:
            throw PatientServiceError.serverError(parseErrorMessage(from: data))

        default:
            throw PatientServiceError.unknown(httpResponse.statusCode)
        }
    }

    /// Fetch patients linked to the current user.
    func fetchLinkedPatients() async throws -> [PatientListItem] {
        let token = try await authService.getAccessToken()

        guard let url = URL(string: "\(baseURL)/patients") else {
            throw PatientServiceError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "GET"
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw PatientServiceError.invalidResponse
        }

        let decoder = JSONDecoder()
        return try decoder.decode([PatientListItem].self, from: data)
    }

    private func parseErrorMessage(from data: Data) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = json["error"] as? String {
            return error
        }
        return "An unknown error occurred"
    }
}

/// Summary of a patient for list display.
struct PatientListItem: Codable, Identifiable {
    let id: String
    let patientId: String
    let name: String
    let relationship: String
}

/// Errors that can occur in patient service operations.
enum PatientServiceError: LocalizedError {
    case invalidURL
    case invalidResponse
    case badRequest(String)
    case unauthorized
    case forbidden
    case serverError(String)
    case unknown(Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .badRequest(let message):
            return message
        case .unauthorized:
            return "Please sign in again"
        case .forbidden:
            return "You don't have permission to perform this action"
        case .serverError(let message):
            return message
        case .unknown(let code):
            return "An error occurred (code: \(code))"
        }
    }
}
