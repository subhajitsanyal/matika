//
//  InviteService.swift
//  CareLog
//
//  Service for sending invites to caregivers
//

import Foundation

/// Service for invite operations.
///
/// Handles:
/// - Sending attendant invites
/// - Sending doctor invites
/// - Managing pending invites
@MainActor
class InviteService: ObservableObject {
    private let baseURL: String
    private let authService: AuthService

    init(authService: AuthService) {
        self.authService = authService
        self.baseURL = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
            ?? "https://api.carelog.com"
    }

    /// Send an attendant invite.
    ///
    /// - Parameters:
    ///   - patientId: The patient ID (CL-XXXXXX format)
    ///   - attendantName: Name of the attendant
    ///   - email: Email address (optional if phone provided)
    ///   - phone: Phone number (optional if email provided)
    /// - Returns: The invite response with ID and expiration
    func sendAttendantInvite(
        patientId: String,
        attendantName: String,
        email: String?,
        phone: String?
    ) async throws -> InviteResponse {
        let token = try await authService.getAccessToken()

        guard let url = URL(string: "\(baseURL)/invites/attendant") else {
            throw InviteServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let body = AttendantInviteRequest(
            patientId: patientId,
            attendantName: attendantName,
            email: email,
            phone: phone
        )

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw InviteServiceError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200...299:
            let decoder = JSONDecoder()
            return try decoder.decode(InviteResponse.self, from: data)

        case 400:
            throw InviteServiceError.badRequest(parseErrorMessage(from: data))

        case 403:
            throw InviteServiceError.forbidden

        case 500...599:
            throw InviteServiceError.serverError(parseErrorMessage(from: data))

        default:
            throw InviteServiceError.unknown(httpResponse.statusCode)
        }
    }

    /// Send a doctor invite.
    ///
    /// - Parameters:
    ///   - patientId: The patient ID
    ///   - doctorName: Name of the doctor
    ///   - doctorEmail: Doctor's email address
    ///   - specialty: Doctor's specialty (optional)
    /// - Returns: The invite response
    func sendDoctorInvite(
        patientId: String,
        doctorName: String,
        doctorEmail: String,
        specialty: String?
    ) async throws -> InviteResponse {
        let token = try await authService.getAccessToken()

        guard let url = URL(string: "\(baseURL)/invites/doctor") else {
            throw InviteServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let body = DoctorInviteRequest(
            patientId: patientId,
            doctorName: doctorName,
            doctorEmail: doctorEmail,
            specialty: specialty
        )

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw InviteServiceError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200...299:
            let decoder = JSONDecoder()
            return try decoder.decode(InviteResponse.self, from: data)

        case 400:
            throw InviteServiceError.badRequest(parseErrorMessage(from: data))

        case 403:
            throw InviteServiceError.forbidden

        default:
            throw InviteServiceError.unknown(httpResponse.statusCode)
        }
    }

    private func parseErrorMessage(from data: Data) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = json["error"] as? String {
            return error
        }
        return "An unknown error occurred"
    }
}

// MARK: - Request/Response Models

struct AttendantInviteRequest: Codable {
    let patientId: String
    let attendantName: String
    let email: String?
    let phone: String?
}

struct DoctorInviteRequest: Codable {
    let patientId: String
    let doctorName: String
    let doctorEmail: String
    let specialty: String?
}

struct InviteResponse: Codable {
    let inviteId: String
    let message: String
    let expiresAt: String
}

// MARK: - Errors

enum InviteServiceError: LocalizedError {
    case invalidURL
    case invalidResponse
    case badRequest(String)
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
        case .forbidden:
            return "You don't have permission to send invites for this patient"
        case .serverError(let message):
            return message
        case .unknown(let code):
            return "An error occurred (code: \(code))"
        }
    }
}
