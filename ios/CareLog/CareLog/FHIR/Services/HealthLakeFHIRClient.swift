//
//  HealthLakeFHIRClient.swift
//  CareLog
//
//  AWS HealthLake implementation of FHIRClient
//

import Foundation

/// AWS HealthLake implementation of FHIRClient.
///
/// Provides CRUD operations for FHIR resources via API Gateway,
/// which proxies to HealthLake.
@MainActor
class HealthLakeFHIRClient: FHIRClient, ObservableObject {
    static let shared = HealthLakeFHIRClient(authService: .shared)

    private let authService: AuthService
    private let baseURL: String

    private let dateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    init(authService: AuthService) {
        self.authService = authService
        self.baseURL = Bundle.main.object(forInfoDictionaryKey: "FHIR_API_BASE_URL") as? String
            ?? "https://api.carelog.com/fhir"
    }

    // MARK: - Patient Operations

    func createPatient(_ patient: FHIRPatient) async throws -> String {
        let response = try await post(path: "Patient", body: patient.toFHIRJSON())
        guard let id = response["id"] as? String else {
            throw FHIRClientError.decodingError("No ID in response")
        }
        return id
    }

    func getPatient(id: String) async throws -> FHIRPatient? {
        guard let response = try await get(path: "Patient/\(id)") else {
            return nil
        }
        return try FHIRPatient.fromFHIRJSON(response)
    }

    func updatePatient(_ patient: FHIRPatient) async throws -> Bool {
        guard let id = patient.id else {
            throw FHIRClientError.decodingError("Patient ID required for update")
        }
        _ = try await put(path: "Patient/\(id)", body: patient.toFHIRJSON())
        return true
    }

    func deletePatient(id: String) async throws -> Bool {
        try await delete(path: "Patient/\(id)")
        return true
    }

    // MARK: - Observation Operations

    func createObservation(_ observation: FHIRObservation) async throws -> String {
        let response = try await post(path: "Observation", body: observation.toFHIRJSON())
        guard let id = response["id"] as? String else {
            throw FHIRClientError.decodingError("No ID in response")
        }
        return id
    }

    func getObservation(id: String) async throws -> FHIRObservation? {
        guard let response = try await get(path: "Observation/\(id)") else {
            return nil
        }
        return try FHIRObservation.fromFHIRJSON(response)
    }

    func getObservationsForPatient(
        patientId: String,
        type: ObservationType?,
        startDate: Date?,
        endDate: Date?,
        limit: Int
    ) async throws -> [FHIRObservation] {
        var params = ["subject": "Patient/\(patientId)"]

        if let type = type {
            params["code"] = type.loincCode
        }
        if let startDate = startDate {
            params["date"] = "ge\(dateFormatter.string(from: startDate))"
        }
        if let endDate = endDate {
            params["date"] = "le\(dateFormatter.string(from: endDate))"
        }
        params["_count"] = String(limit)
        params["_sort"] = "-date"

        let queryString = params.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
        guard let response = try await get(path: "Observation?\(queryString)") else {
            return []
        }

        guard let entries = response["entry"] as? [[String: Any]] else {
            return []
        }

        return entries.compactMap { entry in
            guard let resource = entry["resource"] as? [String: Any] else { return nil }
            return try? FHIRObservation.fromFHIRJSON(resource)
        }
    }

    func deleteObservation(id: String) async throws -> Bool {
        try await delete(path: "Observation/\(id)")
        return true
    }

    // MARK: - DocumentReference Operations

    func createDocumentReference(_ document: FHIRDocumentReference) async throws -> String {
        let response = try await post(path: "DocumentReference", body: document.toFHIRJSON())
        guard let id = response["id"] as? String else {
            throw FHIRClientError.decodingError("No ID in response")
        }
        return id
    }

    func getDocumentReference(id: String) async throws -> FHIRDocumentReference? {
        guard let response = try await get(path: "DocumentReference/\(id)") else {
            return nil
        }
        return try FHIRDocumentReference.fromFHIRJSON(response)
    }

    func getDocumentsForPatient(
        patientId: String,
        type: DocumentType?,
        limit: Int
    ) async throws -> [FHIRDocumentReference] {
        var params = ["subject": "Patient/\(patientId)"]

        if let type = type {
            params["type"] = type.rawValue
        }
        params["_count"] = String(limit)
        params["_sort"] = "-date"

        let queryString = params.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
        guard let response = try await get(path: "DocumentReference?\(queryString)") else {
            return []
        }

        guard let entries = response["entry"] as? [[String: Any]] else {
            return []
        }

        return entries.compactMap { entry in
            guard let resource = entry["resource"] as? [String: Any] else { return nil }
            return try? FHIRDocumentReference.fromFHIRJSON(resource)
        }
    }

    func deleteDocumentReference(id: String) async throws -> Bool {
        try await delete(path: "DocumentReference/\(id)")
        return true
    }

    // MARK: - CarePlan Operations

    func createCarePlan(_ carePlan: FHIRCarePlan) async throws -> String {
        let response = try await post(path: "CarePlan", body: carePlan.toFHIRJSON())
        guard let id = response["id"] as? String else {
            throw FHIRClientError.decodingError("No ID in response")
        }
        return id
    }

    func getCarePlan(id: String) async throws -> FHIRCarePlan? {
        guard let response = try await get(path: "CarePlan/\(id)") else {
            return nil
        }
        return try FHIRCarePlan.fromFHIRJSON(response)
    }

    func getCarePlansForPatient(patientId: String) async throws -> [FHIRCarePlan] {
        guard let response = try await get(path: "CarePlan?subject=Patient/\(patientId)&status=active") else {
            return []
        }

        guard let entries = response["entry"] as? [[String: Any]] else {
            return []
        }

        return entries.compactMap { entry in
            guard let resource = entry["resource"] as? [String: Any] else { return nil }
            return try? FHIRCarePlan.fromFHIRJSON(resource)
        }
    }

    func updateCarePlan(_ carePlan: FHIRCarePlan) async throws -> Bool {
        guard let id = carePlan.id else {
            throw FHIRClientError.decodingError("CarePlan ID required for update")
        }
        _ = try await put(path: "CarePlan/\(id)", body: carePlan.toFHIRJSON())
        return true
    }

    func deleteCarePlan(id: String) async throws -> Bool {
        try await delete(path: "CarePlan/\(id)")
        return true
    }

    // MARK: - HTTP Methods

    private func get(path: String) async throws -> [String: Any]? {
        guard let url = URL(string: "\(baseURL)/\(path)") else {
            throw FHIRClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/fhir+json", forHTTPHeaderField: "Accept")

        let token = try await authService.getAccessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw FHIRClientError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200...299:
            return try JSONSerialization.jsonObject(with: data) as? [String: Any]
        case 404:
            return nil
        default:
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw FHIRClientError.serverError(httpResponse.statusCode, message)
        }
    }

    private func post(path: String, body: [String: Any]) async throws -> [String: Any] {
        guard let url = URL(string: "\(baseURL)/\(path)") else {
            throw FHIRClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/fhir+json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/fhir+json", forHTTPHeaderField: "Accept")

        let token = try await authService.getAccessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw FHIRClientError.invalidResponse
        }

        guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw FHIRClientError.serverError(httpResponse.statusCode, message)
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw FHIRClientError.decodingError("Invalid JSON response")
        }

        return json
    }

    private func put(path: String, body: [String: Any]) async throws -> [String: Any] {
        guard let url = URL(string: "\(baseURL)/\(path)") else {
            throw FHIRClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/fhir+json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/fhir+json", forHTTPHeaderField: "Accept")

        let token = try await authService.getAccessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw FHIRClientError.invalidResponse
        }

        guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw FHIRClientError.serverError(httpResponse.statusCode, message)
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw FHIRClientError.decodingError("Invalid JSON response")
        }

        return json
    }

    private func delete(path: String) async throws {
        guard let url = URL(string: "\(baseURL)/\(path)") else {
            throw FHIRClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        let token = try await authService.getAccessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw FHIRClientError.invalidResponse
        }

        guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw FHIRClientError.serverError(httpResponse.statusCode, message)
        }
    }
}
