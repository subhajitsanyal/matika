//
//  FHIRClient.swift
//  CareLog
//
//  FHIR client protocol and HealthLake implementation
//

import Foundation

// MARK: - FHIR Client Protocol

/// Protocol defining FHIR CRUD operations for CareLog resources.
protocol FHIRClient {
    // Patient Operations
    func createPatient(_ patient: FHIRPatient) async throws -> String
    func getPatient(id: String) async throws -> FHIRPatient?
    func updatePatient(_ patient: FHIRPatient) async throws -> Bool
    func deletePatient(id: String) async throws -> Bool

    // Observation Operations
    func createObservation(_ observation: FHIRObservation) async throws -> String
    func getObservation(id: String) async throws -> FHIRObservation?
    func getObservationsForPatient(
        patientId: String,
        type: ObservationType?,
        startDate: Date?,
        endDate: Date?,
        limit: Int
    ) async throws -> [FHIRObservation]
    func deleteObservation(id: String) async throws -> Bool

    // DocumentReference Operations
    func createDocumentReference(_ document: FHIRDocumentReference) async throws -> String
    func getDocumentReference(id: String) async throws -> FHIRDocumentReference?
    func getDocumentsForPatient(
        patientId: String,
        type: DocumentType?,
        limit: Int
    ) async throws -> [FHIRDocumentReference]
    func deleteDocumentReference(id: String) async throws -> Bool

    // CarePlan Operations
    func createCarePlan(_ carePlan: FHIRCarePlan) async throws -> String
    func getCarePlan(id: String) async throws -> FHIRCarePlan?
    func getCarePlansForPatient(patientId: String) async throws -> [FHIRCarePlan]
    func updateCarePlan(_ carePlan: FHIRCarePlan) async throws -> Bool
    func deleteCarePlan(id: String) async throws -> Bool
}

// MARK: - Observation Types

/// Observation types supported by CareLog with LOINC codes.
enum ObservationType: String, CaseIterable, Codable {
    case bodyWeight = "29463-7"
    case bloodGlucose = "2339-0"
    case bodyTemperature = "8310-5"
    case bloodPressure = "85354-9"
    case systolicBP = "8480-6"
    case diastolicBP = "8462-4"
    case heartRate = "8867-4"
    case oxygenSaturation = "2708-6"

    var loincCode: String { rawValue }

    var displayName: String {
        switch self {
        case .bodyWeight: return "Body weight"
        case .bloodGlucose: return "Glucose [Mass/volume] in Blood"
        case .bodyTemperature: return "Body temperature"
        case .bloodPressure: return "Blood pressure panel"
        case .systolicBP: return "Systolic blood pressure"
        case .diastolicBP: return "Diastolic blood pressure"
        case .heartRate: return "Heart rate"
        case .oxygenSaturation: return "Oxygen saturation in Arterial blood"
        }
    }

    var defaultUnit: String {
        switch self {
        case .bodyWeight: return "kg"
        case .bloodGlucose: return "mg/dL"
        case .bodyTemperature: return "°F"
        case .bloodPressure, .systolicBP, .diastolicBP: return "mmHg"
        case .heartRate: return "/min"
        case .oxygenSaturation: return "%"
        }
    }
}

// MARK: - Document Types

/// Document types supported by CareLog.
enum DocumentType: String, CaseIterable, Codable {
    case prescription = "prescription"
    case labReport = "lab_report"
    case imaging = "imaging"
    case dischargeSummary = "discharge_summary"
    case other = "other"

    var loincCode: String {
        switch self {
        case .prescription: return "57833-6"
        case .labReport: return "11502-2"
        case .imaging: return "18748-4"
        case .dischargeSummary: return "18842-5"
        case .other: return "34133-9"
        }
    }

    var displayName: String {
        switch self {
        case .prescription: return "Prescription for medication"
        case .labReport: return "Laboratory report"
        case .imaging: return "Diagnostic imaging report"
        case .dischargeSummary: return "Discharge summary"
        case .other: return "Summary of episode note"
        }
    }
}

// MARK: - Interpretation Codes

/// Observation interpretation codes.
enum InterpretationCode: String, Codable {
    case low = "L"
    case normal = "N"
    case high = "H"
    case criticallyLow = "LL"
    case criticallyHigh = "HH"

    var display: String {
        switch self {
        case .low: return "Low"
        case .normal: return "Normal"
        case .high: return "High"
        case .criticallyLow: return "Critically Low"
        case .criticallyHigh: return "Critically High"
        }
    }
}

// MARK: - FHIR Client Errors

enum FHIRClientError: LocalizedError {
    case notAuthenticated
    case invalidURL
    case invalidResponse
    case resourceNotFound
    case serverError(Int, String)
    case encodingError
    case decodingError(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Not authenticated"
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .resourceNotFound:
            return "Resource not found"
        case .serverError(let code, let message):
            return "Server error (\(code)): \(message)"
        case .encodingError:
            return "Failed to encode request"
        case .decodingError(let message):
            return "Failed to decode response: \(message)"
        }
    }
}
