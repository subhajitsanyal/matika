//
//  CreatePatientRequest.swift
//  CareLog
//
//  Request model for patient creation API
//

import Foundation

/// Request body for creating a new patient.
struct CreatePatientRequest: Codable {
    let name: String
    let dateOfBirth: String?
    let gender: String?
    let bloodType: String?
    let medicalConditions: [String]
    let allergies: [String]
    let medications: [String]
    let emergencyContactName: String?
    let emergencyContactPhone: String?
}

/// Response from patient creation API.
struct CreatePatientResponse: Codable {
    let patientId: String
    let message: String
}

/// Gender options for patient profile UI display.
enum PatientGenderOption: String, CaseIterable, Identifiable {
    case male = "Male"
    case female = "Female"
    case other = "Other"
    case preferNotToSay = "Prefer not to say"

    var id: String { rawValue }
}

/// Blood type options for patient profile.
enum BloodType: String, CaseIterable, Identifiable {
    case aPositive = "A+"
    case aNegative = "A-"
    case bPositive = "B+"
    case bNegative = "B-"
    case abPositive = "AB+"
    case abNegative = "AB-"
    case oPositive = "O+"
    case oNegative = "O-"
    case unknown = "Unknown"

    var id: String { rawValue }
}
