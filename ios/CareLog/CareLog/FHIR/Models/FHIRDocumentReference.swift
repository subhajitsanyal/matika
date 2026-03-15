//
//  FHIRDocumentReference.swift
//  CareLog
//
//  FHIR DocumentReference resource model
//

import Foundation

/// CareLog representation of a FHIR DocumentReference resource.
struct FHIRDocumentReference: Codable, Identifiable {
    var id: String?
    let patientId: String
    let documentId: String  // UUID
    let type: DocumentType
    let title: String
    var description: String?
    let contentUrl: String  // S3 URL or presigned URL
    let contentType: String  // MIME type
    var size: Int64?
    let date: Date
    var authorId: String?
    var authorName: String?
    var authorType: PerformerType
    var status: DocumentStatus
    var periodStart: String?
    var periodEnd: String?

    init(
        id: String? = nil,
        patientId: String,
        documentId: String,
        type: DocumentType,
        title: String,
        description: String? = nil,
        contentUrl: String,
        contentType: String,
        size: Int64? = nil,
        date: Date,
        authorId: String? = nil,
        authorName: String? = nil,
        authorType: PerformerType = .relatedPerson,
        status: DocumentStatus = .current,
        periodStart: String? = nil,
        periodEnd: String? = nil
    ) {
        self.id = id
        self.patientId = patientId
        self.documentId = documentId
        self.type = type
        self.title = title
        self.description = description
        self.contentUrl = contentUrl
        self.contentType = contentType
        self.size = size
        self.date = date
        self.authorId = authorId
        self.authorName = authorName
        self.authorType = authorType
        self.status = status
        self.periodStart = periodStart
        self.periodEnd = periodEnd
    }
}

/// Document status as defined in FHIR.
enum DocumentStatus: String, Codable {
    case current
    case superseded
    case enteredInError = "entered-in-error"
}

// MARK: - FHIR JSON Conversion

extension FHIRDocumentReference {
    private static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Convert to FHIR JSON representation.
    func toFHIRJSON() -> [String: Any] {
        var resource: [String: Any] = [
            "resourceType": "DocumentReference",
            "identifier": [
                [
                    "system": "https://carelog.com/document-id",
                    "value": documentId
                ]
            ],
            "status": status.rawValue,
            "type": [
                "coding": [
                    [
                        "system": "https://carelog.com/fhir/CodeSystem/document-type",
                        "code": type.rawValue,
                        "display": type.displayName
                    ],
                    [
                        "system": "http://loinc.org",
                        "code": type.loincCode,
                        "display": type.displayName
                    ]
                ]
            ],
            "category": [
                [
                    "coding": [
                        [
                            "system": "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
                            "code": "clinical-note",
                            "display": "Clinical Note"
                        ]
                    ]
                ]
            ],
            "subject": ["reference": "Patient/\(patientId)"],
            "date": Self.iso8601Formatter.string(from: date)
        ]

        if let id = id {
            resource["id"] = id
        }

        if let description = description {
            resource["description"] = description
        }

        // Content/attachment
        var attachment: [String: Any] = [
            "contentType": contentType,
            "url": contentUrl,
            "title": title,
            "creation": Self.iso8601Formatter.string(from: date)
        ]
        if let size = size {
            attachment["size"] = size
        }
        resource["content"] = [["attachment": attachment]]

        // Author
        if authorId != nil || authorName != nil {
            var author: [String: Any] = [:]
            if let authorId = authorId {
                author["reference"] = "\(authorType.rawValue)/\(authorId)"
            }
            if let authorName = authorName {
                author["display"] = authorName
            }
            resource["author"] = [author]
        }

        // Context/period
        if periodStart != nil || periodEnd != nil {
            var period: [String: Any] = [:]
            if let start = periodStart { period["start"] = start }
            if let end = periodEnd { period["end"] = end }
            resource["context"] = ["period": period]
        }

        return resource
    }

    /// Parse from FHIR JSON.
    static func fromFHIRJSON(_ json: [String: Any]) throws -> FHIRDocumentReference {
        let id = json["id"] as? String

        guard let identifiers = json["identifier"] as? [[String: Any]],
              let documentId = identifiers.first?["value"] as? String else {
            throw FHIRClientError.decodingError("Missing document identifier")
        }

        guard let subject = json["subject"] as? [String: Any],
              let reference = subject["reference"] as? String else {
            throw FHIRClientError.decodingError("Missing subject reference")
        }
        let patientId = reference.replacingOccurrences(of: "Patient/", with: "")

        let typeDict = json["type"] as? [String: Any]
        let typeCoding = typeDict?["coding"] as? [[String: Any]]
        let typeCode = typeCoding?.first?["code"] as? String ?? "other"
        let type = DocumentType(rawValue: typeCode) ?? .other

        let statusString = json["status"] as? String ?? "current"
        let status = DocumentStatus(rawValue: statusString) ?? .current

        let description = json["description"] as? String

        guard let dateString = json["date"] as? String,
              let date = iso8601Formatter.date(from: dateString) else {
            throw FHIRClientError.decodingError("Missing or invalid date")
        }

        guard let content = json["content"] as? [[String: Any]],
              let attachment = content.first?["attachment"] as? [String: Any] else {
            throw FHIRClientError.decodingError("Missing content attachment")
        }

        let contentUrl = attachment["url"] as? String ?? ""
        let contentType = attachment["contentType"] as? String ?? ""
        let title = attachment["title"] as? String ?? ""
        let size = attachment["size"] as? Int64

        return FHIRDocumentReference(
            id: id,
            patientId: patientId,
            documentId: documentId,
            type: type,
            title: title,
            description: description,
            contentUrl: contentUrl,
            contentType: contentType,
            size: size,
            date: date,
            status: status
        )
    }
}
