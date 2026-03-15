//
//  FHIRPatient.swift
//  CareLog
//
//  FHIR Patient resource model
//

import Foundation

/// CareLog representation of a FHIR Patient resource.
struct FHIRPatient: Codable, Identifiable {
    var id: String?
    let patientId: String  // CL-XXXXXX format
    let name: String
    var birthDate: String?  // YYYY-MM-DD
    var gender: PatientGender
    var bloodType: String?
    var emergencyContact: EmergencyContact?
    var active: Bool

    init(
        id: String? = nil,
        patientId: String,
        name: String,
        birthDate: String? = nil,
        gender: PatientGender = .unknown,
        bloodType: String? = nil,
        emergencyContact: EmergencyContact? = nil,
        active: Bool = true
    ) {
        self.id = id
        self.patientId = patientId
        self.name = name
        self.birthDate = birthDate
        self.gender = gender
        self.bloodType = bloodType
        self.emergencyContact = emergencyContact
        self.active = active
    }
}

/// Patient gender as defined in FHIR.
enum PatientGender: String, Codable, CaseIterable {
    case male
    case female
    case other
    case unknown

    init(from string: String?) {
        switch string?.lowercased() {
        case "male": self = .male
        case "female": self = .female
        case "other": self = .other
        default: self = .unknown
        }
    }
}

/// Emergency contact information.
struct EmergencyContact: Codable {
    let name: String
    var phone: String?
    var relationship: String

    init(name: String, phone: String? = nil, relationship: String = "C") {
        self.name = name
        self.phone = phone
        self.relationship = relationship
    }
}

// MARK: - FHIR JSON Conversion

extension FHIRPatient {
    /// Convert to FHIR JSON representation.
    func toFHIRJSON() -> [String: Any] {
        var resource: [String: Any] = [
            "resourceType": "Patient",
            "identifier": [
                [
                    "system": "https://carelog.com/patient-id",
                    "value": patientId
                ]
            ],
            "active": active,
            "name": [
                [
                    "use": "official",
                    "text": name
                ]
            ],
            "gender": gender.rawValue
        ]

        if let id = id {
            resource["id"] = id
        }

        if let birthDate = birthDate {
            resource["birthDate"] = birthDate
        }

        if let bloodType = bloodType {
            resource["extension"] = [
                [
                    "url": "https://carelog.com/fhir/StructureDefinition/blood-type",
                    "valueString": bloodType
                ]
            ]
        }

        if let contact = emergencyContact {
            var contactDict: [String: Any] = [
                "relationship": [
                    [
                        "coding": [
                            [
                                "system": "http://terminology.hl7.org/CodeSystem/v2-0131",
                                "code": contact.relationship,
                                "display": "Emergency Contact"
                            ]
                        ]
                    ]
                ],
                "name": ["text": contact.name]
            ]

            if let phone = contact.phone {
                contactDict["telecom"] = [
                    [
                        "system": "phone",
                        "value": phone,
                        "use": "mobile"
                    ]
                ]
            }

            resource["contact"] = [contactDict]
        }

        return resource
    }

    /// Parse from FHIR JSON.
    static func fromFHIRJSON(_ json: [String: Any]) throws -> FHIRPatient {
        let id = json["id"] as? String

        guard let identifiers = json["identifier"] as? [[String: Any]],
              let patientId = identifiers.first?["value"] as? String else {
            throw FHIRClientError.decodingError("Missing patient identifier")
        }

        let names = json["name"] as? [[String: Any]]
        let name = names?.first?["text"] as? String ?? ""

        let genderString = json["gender"] as? String
        let gender = PatientGender(from: genderString)

        let birthDate = json["birthDate"] as? String
        let active = json["active"] as? Bool ?? true

        var bloodType: String?
        if let extensions = json["extension"] as? [[String: Any]] {
            for ext in extensions {
                if let url = ext["url"] as? String, url.contains("blood-type") {
                    bloodType = ext["valueString"] as? String
                    break
                }
            }
        }

        var emergencyContact: EmergencyContact?
        if let contacts = json["contact"] as? [[String: Any]], let contact = contacts.first {
            if let nameDict = contact["name"] as? [String: Any],
               let contactName = nameDict["text"] as? String {
                let telecom = contact["telecom"] as? [[String: Any]]
                let phone = telecom?.first?["value"] as? String
                emergencyContact = EmergencyContact(name: contactName, phone: phone)
            }
        }

        return FHIRPatient(
            id: id,
            patientId: patientId,
            name: name,
            birthDate: birthDate,
            gender: gender,
            bloodType: bloodType,
            emergencyContact: emergencyContact,
            active: active
        )
    }
}
