//
//  FHIRCarePlan.swift
//  CareLog
//
//  FHIR CarePlan resource model
//

import Foundation

/// CareLog representation of a FHIR CarePlan resource.
struct FHIRCarePlan: Codable, Identifiable {
    var id: String?
    let patientId: String
    let planId: String  // UUID
    let title: String
    var description: String?
    var status: CarePlanStatus
    var intent: CarePlanIntent
    var periodStart: String?  // ISO 8601 date
    var periodEnd: String?
    var created: Date?
    var authorId: String?
    var authorType: PerformerType
    var activities: [CarePlanActivity]

    init(
        id: String? = nil,
        patientId: String,
        planId: String,
        title: String,
        description: String? = nil,
        status: CarePlanStatus = .active,
        intent: CarePlanIntent = .plan,
        periodStart: String? = nil,
        periodEnd: String? = nil,
        created: Date? = nil,
        authorId: String? = nil,
        authorType: PerformerType = .relatedPerson,
        activities: [CarePlanActivity] = []
    ) {
        self.id = id
        self.patientId = patientId
        self.planId = planId
        self.title = title
        self.description = description
        self.status = status
        self.intent = intent
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.created = created
        self.authorId = authorId
        self.authorType = authorType
        self.activities = activities
    }
}

/// Care plan status as defined in FHIR.
enum CarePlanStatus: String, Codable {
    case draft
    case active
    case onHold = "on-hold"
    case revoked
    case completed
    case unknown
}

/// Care plan intent as defined in FHIR.
enum CarePlanIntent: String, Codable {
    case proposal
    case plan
    case order
    case option
}

/// Care plan activity (scheduled task).
struct CarePlanActivity: Codable, Identifiable {
    var id: String?
    let kind: ActivityKind
    let code: ActivityCode
    let description: String
    var status: ActivityStatus
    var schedule: ActivitySchedule?

    init(
        id: String? = nil,
        kind: ActivityKind,
        code: ActivityCode,
        description: String,
        status: ActivityStatus = .scheduled,
        schedule: ActivitySchedule? = nil
    ) {
        self.id = id
        self.kind = kind
        self.code = code
        self.description = description
        self.status = status
        self.schedule = schedule
    }
}

/// Type of activity.
enum ActivityKind: String, Codable {
    case serviceRequest = "ServiceRequest"  // Vital measurement
    case medicationRequest = "MedicationRequest"  // Medication reminder
}

/// Activity code (observation type or medication).
struct ActivityCode: Codable {
    let system: String
    let code: String
    let display: String

    static func fromObservationType(_ type: ObservationType) -> ActivityCode {
        ActivityCode(
            system: "http://loinc.org",
            code: type.loincCode,
            display: type.displayName
        )
    }

    static func medication(rxNormCode: String, name: String) -> ActivityCode {
        ActivityCode(
            system: "http://www.nlm.nih.gov/research/umls/rxnorm",
            code: rxNormCode,
            display: name
        )
    }
}

/// Activity status as defined in FHIR.
enum ActivityStatus: String, Codable {
    case notStarted = "not-started"
    case scheduled
    case inProgress = "in-progress"
    case onHold = "on-hold"
    case completed
    case cancelled
    case stopped
    case unknown
}

/// Activity schedule (when to perform).
struct ActivitySchedule: Codable {
    var frequency: Int
    var period: Int
    var periodUnit: PeriodUnit
    var timeOfDay: [String]  // HH:mm:ss format
    var `when`: [TimingEvent]

    init(
        frequency: Int = 1,
        period: Int = 1,
        periodUnit: PeriodUnit = .day,
        timeOfDay: [String] = [],
        when: [TimingEvent] = []
    ) {
        self.frequency = frequency
        self.period = period
        self.periodUnit = periodUnit
        self.timeOfDay = timeOfDay
        self.when = when
    }
}

/// Period unit for scheduling.
enum PeriodUnit: String, Codable {
    case second = "s"
    case minute = "min"
    case hour = "h"
    case day = "d"
    case week = "wk"
    case month = "mo"
    case year = "a"
}

/// Timing events (when in relation to meals, etc.).
enum TimingEvent: String, Codable {
    case morning = "MORN"
    case afternoon = "AFT"
    case evening = "EVE"
    case night = "NIGHT"
    case beforeMeal = "AC"
    case afterMeal = "PC"
    case beforeBreakfast = "ACM"
    case afterBreakfast = "PCM"
    case beforeLunch = "ACD"
    case afterLunch = "PCD"
    case beforeDinner = "ACV"
    case afterDinner = "PCV"
}

// MARK: - FHIR JSON Conversion

extension FHIRCarePlan {
    private static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Convert to FHIR JSON representation.
    func toFHIRJSON() -> [String: Any] {
        var resource: [String: Any] = [
            "resourceType": "CarePlan",
            "identifier": [
                [
                    "system": "https://carelog.com/careplan-id",
                    "value": planId
                ]
            ],
            "status": status.rawValue,
            "intent": intent.rawValue,
            "category": [
                [
                    "coding": [
                        [
                            "system": "http://hl7.org/fhir/us/core/CodeSystem/careplan-category",
                            "code": "assess-plan",
                            "display": "Assessment and Plan of Treatment"
                        ]
                    ]
                ]
            ],
            "title": title,
            "subject": ["reference": "Patient/\(patientId)"]
        ]

        if let id = id {
            resource["id"] = id
        }

        if let description = description {
            resource["description"] = description
        }

        if let created = created {
            resource["created"] = Self.iso8601Formatter.string(from: created)
        }

        if periodStart != nil || periodEnd != nil {
            var period: [String: Any] = [:]
            if let start = periodStart { period["start"] = start }
            if let end = periodEnd { period["end"] = end }
            resource["period"] = period
        }

        if let authorId = authorId {
            resource["author"] = ["reference": "\(authorType.rawValue)/\(authorId)"]
        }

        if !activities.isEmpty {
            resource["activity"] = activities.map { activity -> [String: Any] in
                var detail: [String: Any] = [
                    "kind": activity.kind.rawValue,
                    "code": [
                        "coding": [
                            [
                                "system": activity.code.system,
                                "code": activity.code.code,
                                "display": activity.code.display
                            ]
                        ]
                    ],
                    "status": activity.status.rawValue,
                    "description": activity.description
                ]

                if let schedule = activity.schedule {
                    var repeat_: [String: Any] = [
                        "frequency": schedule.frequency,
                        "period": schedule.period,
                        "periodUnit": schedule.periodUnit.rawValue
                    ]
                    if !schedule.timeOfDay.isEmpty {
                        repeat_["timeOfDay"] = schedule.timeOfDay
                    }
                    if !schedule.when.isEmpty {
                        repeat_["when"] = schedule.when.map { $0.rawValue }
                    }
                    detail["scheduledTiming"] = ["repeat": repeat_]
                }

                return ["detail": detail]
            }
        }

        return resource
    }

    /// Parse from FHIR JSON.
    static func fromFHIRJSON(_ json: [String: Any]) throws -> FHIRCarePlan {
        let id = json["id"] as? String

        guard let identifiers = json["identifier"] as? [[String: Any]],
              let planId = identifiers.first?["value"] as? String else {
            throw FHIRClientError.decodingError("Missing care plan identifier")
        }

        guard let subject = json["subject"] as? [String: Any],
              let reference = subject["reference"] as? String else {
            throw FHIRClientError.decodingError("Missing subject reference")
        }
        let patientId = reference.replacingOccurrences(of: "Patient/", with: "")

        let title = json["title"] as? String ?? ""
        let description = json["description"] as? String

        let statusString = json["status"] as? String ?? "active"
        let status = CarePlanStatus(rawValue: statusString) ?? .active

        let intentString = json["intent"] as? String ?? "plan"
        let intent = CarePlanIntent(rawValue: intentString) ?? .plan

        let period = json["period"] as? [String: Any]
        let periodStart = period?["start"] as? String
        let periodEnd = period?["end"] as? String

        return FHIRCarePlan(
            id: id,
            patientId: patientId,
            planId: planId,
            title: title,
            description: description,
            status: status,
            intent: intent,
            periodStart: periodStart,
            periodEnd: periodEnd
        )
    }
}
