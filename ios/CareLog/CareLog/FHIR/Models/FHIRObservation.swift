//
//  FHIRObservation.swift
//  CareLog
//
//  FHIR Observation resource model for vital signs
//

import Foundation

/// CareLog representation of a FHIR Observation resource.
struct FHIRObservation: Codable, Identifiable {
    var id: String?
    let patientId: String
    let type: ObservationType
    let effectiveDateTime: Date
    var value: Double?
    var unit: String?
    var components: [ObservationComponent]?  // For BP with systolic/diastolic
    var interpretation: InterpretationCode?
    var performerId: String?
    var performerType: PerformerType
    var note: String?
    var context: MeasurementContext?
    var status: ObservationStatus

    init(
        id: String? = nil,
        patientId: String,
        type: ObservationType,
        effectiveDateTime: Date,
        value: Double? = nil,
        unit: String? = nil,
        components: [ObservationComponent]? = nil,
        interpretation: InterpretationCode? = nil,
        performerId: String? = nil,
        performerType: PerformerType = .relatedPerson,
        note: String? = nil,
        context: MeasurementContext? = nil,
        status: ObservationStatus = .final
    ) {
        self.id = id
        self.patientId = patientId
        self.type = type
        self.effectiveDateTime = effectiveDateTime
        self.value = value
        self.unit = unit
        self.components = components
        self.interpretation = interpretation
        self.performerId = performerId
        self.performerType = performerType
        self.note = note
        self.context = context
        self.status = status
    }
}

/// Component for multi-value observations (e.g., blood pressure).
struct ObservationComponent: Codable {
    let type: ObservationType
    let value: Double
    let unit: String
}

/// Type of performer who recorded the observation.
enum PerformerType: String, Codable {
    case practitioner = "Practitioner"
    case relatedPerson = "RelatedPerson"
    case patient = "Patient"
}

/// Observation status as defined in FHIR.
enum ObservationStatus: String, Codable {
    case registered
    case preliminary
    case final
    case amended
    case cancelled
}

/// Context for measurements (e.g., fasting glucose).
struct MeasurementContext: Codable {
    var fasting: Bool
    var postMeal: Bool
    var beforeMedication: Bool
    var afterExercise: Bool

    init(fasting: Bool = false, postMeal: Bool = false, beforeMedication: Bool = false, afterExercise: Bool = false) {
        self.fasting = fasting
        self.postMeal = postMeal
        self.beforeMedication = beforeMedication
        self.afterExercise = afterExercise
    }
}

// MARK: - FHIR JSON Conversion

extension FHIRObservation {
    private static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Convert to FHIR JSON representation.
    func toFHIRJSON() -> [String: Any] {
        var resource: [String: Any] = [
            "resourceType": "Observation",
            "status": status.rawValue,
            "category": [
                [
                    "coding": [
                        [
                            "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                            "code": "vital-signs",
                            "display": "Vital Signs"
                        ]
                    ]
                ]
            ],
            "code": [
                "coding": [
                    [
                        "system": "http://loinc.org",
                        "code": type.loincCode,
                        "display": type.displayName
                    ]
                ]
            ],
            "subject": ["reference": "Patient/\(patientId)"],
            "effectiveDateTime": Self.iso8601Formatter.string(from: effectiveDateTime)
        ]

        if let id = id {
            resource["id"] = id
        }

        // Handle single value or components
        if type == .bloodPressure, let components = components {
            resource["component"] = components.map { component in
                [
                    "code": [
                        "coding": [
                            [
                                "system": "http://loinc.org",
                                "code": component.type.loincCode,
                                "display": component.type.displayName
                            ]
                        ]
                    ],
                    "valueQuantity": [
                        "value": component.value,
                        "unit": component.unit,
                        "system": "http://unitsofmeasure.org",
                        "code": ucumCode(for: component.unit)
                    ]
                ]
            }
        } else if let value = value {
            let unitString = unit ?? type.defaultUnit
            resource["valueQuantity"] = [
                "value": value,
                "unit": unitString,
                "system": "http://unitsofmeasure.org",
                "code": ucumCode(for: unitString)
            ]
        }

        if let interpretation = interpretation {
            resource["interpretation"] = [
                [
                    "coding": [
                        [
                            "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                            "code": interpretation.rawValue,
                            "display": interpretation.display
                        ]
                    ]
                ]
            ]
        }

        if let performerId = performerId {
            resource["performer"] = [
                ["reference": "\(performerType.rawValue)/\(performerId)"]
            ]
        }

        if let note = note {
            resource["note"] = [["text": note]]
        }

        return resource
    }

    /// Parse from FHIR JSON.
    static func fromFHIRJSON(_ json: [String: Any]) throws -> FHIRObservation {
        let id = json["id"] as? String

        guard let subject = json["subject"] as? [String: Any],
              let reference = subject["reference"] as? String else {
            throw FHIRClientError.decodingError("Missing subject reference")
        }
        let patientId = reference.replacingOccurrences(of: "Patient/", with: "")

        guard let code = json["code"] as? [String: Any],
              let coding = code["coding"] as? [[String: Any]],
              let loincCode = coding.first?["code"] as? String else {
            throw FHIRClientError.decodingError("Missing observation code")
        }

        let type = ObservationType(rawValue: loincCode) ?? .bodyWeight

        guard let dateTimeString = json["effectiveDateTime"] as? String,
              let effectiveDateTime = iso8601Formatter.date(from: dateTimeString) else {
            throw FHIRClientError.decodingError("Missing or invalid effectiveDateTime")
        }

        let statusString = json["status"] as? String ?? "final"
        let status = ObservationStatus(rawValue: statusString) ?? .final

        var value: Double?
        var unit: String?
        if let valueQuantity = json["valueQuantity"] as? [String: Any] {
            value = valueQuantity["value"] as? Double
            unit = valueQuantity["unit"] as? String
        }

        var components: [ObservationComponent]?
        if let componentArray = json["component"] as? [[String: Any]] {
            components = componentArray.compactMap { comp in
                guard let compCode = comp["code"] as? [String: Any],
                      let compCoding = compCode["coding"] as? [[String: Any]],
                      let compLoincCode = compCoding.first?["code"] as? String,
                      let compType = ObservationType(rawValue: compLoincCode),
                      let compValue = comp["valueQuantity"] as? [String: Any],
                      let compValueNum = compValue["value"] as? Double,
                      let compUnit = compValue["unit"] as? String else {
                    return nil
                }
                return ObservationComponent(type: compType, value: compValueNum, unit: compUnit)
            }
        }

        return FHIRObservation(
            id: id,
            patientId: patientId,
            type: type,
            effectiveDateTime: effectiveDateTime,
            value: value,
            unit: unit,
            components: components,
            status: status
        )
    }

    private func ucumCode(for unit: String) -> String {
        switch unit.lowercased() {
        case "kg": return "kg"
        case "lb": return "[lb_av]"
        case "mg/dl": return "mg/dL"
        case "mmhg": return "mm[Hg]"
        case "/min", "beats/minute", "bpm": return "/min"
        case "%": return "%"
        case "°f": return "[degF]"
        case "°c": return "Cel"
        default: return unit
        }
    }
}
