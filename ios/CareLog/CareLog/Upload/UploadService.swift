import Foundation
import UIKit

/// Service for uploading unstructured data (photos, documents, audio, video).
///
/// Flow:
/// 1. Request presigned URL from API
/// 2. Upload file directly to S3
/// 3. Create FHIR DocumentReference locally
/// 4. Add to sync queue
/// 5. Play voice acknowledgement
final class UploadService {
    static let shared = UploadService()

    // MARK: - Dependencies

    private let authService = AuthService.shared
    private let localFHIRRepository = LocalFHIRRepository.shared
    private let voicePlayer = VoiceAcknowledgementPlayer.shared

    private let apiBaseURL = "https://api.carelog.app" // TODO: Get from config
    private let session: URLSession

    // MARK: - Initialization

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        session = URLSession(configuration: config)
    }

    // MARK: - Public Methods

    /// Upload a file to S3 and create DocumentReference.
    func uploadFile(
        data: Data,
        fileType: FileType,
        contentType: String,
        description: String? = nil,
        progressHandler: ((Double) -> Void)? = nil
    ) async throws -> UploadResult {
        // Get user info
        guard let user = await authService.getCurrentUser(),
              let patientId = user.linkedPatientId else {
            throw UploadError.notAuthenticated
        }

        // 1. Get presigned URL
        let presignedResponse = try await getPresignedURL(
            patientId: patientId,
            fileType: fileType,
            contentType: contentType
        )

        // 2. Upload to S3
        do {
            try await uploadToS3(
                url: presignedResponse.uploadURL,
                data: data,
                contentType: contentType,
                progressHandler: progressHandler
            )
        } catch {
            voicePlayer.playFailure()
            throw UploadError.uploadFailed(error.localizedDescription)
        }

        // 3. Create FHIRDocumentReference
        let documentId = UUID().uuidString
        let tempFilePath = FileManager.default.temporaryDirectory.appendingPathComponent(documentId).path
        let documentRef = FHIRDocumentReference(
            patientId: patientId,
            documentId: documentId,
            type: fileType.toDocumentType(),
            title: description ?? fileType.displayName,
            description: description,
            contentUrl: presignedResponse.s3Key,
            contentType: contentType,
            date: Date(),
            authorName: user.name
        )

        // 4. Save to local store (adds to sync queue)
        let localId = try await localFHIRRepository.saveDocumentReference(documentRef, localFilePath: tempFilePath)

        // 5. Play success acknowledgement
        voicePlayer.playUploadSuccess()

        return UploadResult(
            documentId: localId,
            s3Key: presignedResponse.s3Key
        )
    }

    /// Upload an image to S3.
    func uploadImage(
        image: UIImage,
        fileType: FileType,
        description: String? = nil,
        progressHandler: ((Double) -> Void)? = nil
    ) async throws -> UploadResult {
        guard let data = image.jpegData(compressionQuality: 0.8) else {
            throw UploadError.invalidData
        }

        return try await uploadFile(
            data: data,
            fileType: fileType,
            contentType: "image/jpeg",
            description: description,
            progressHandler: progressHandler
        )
    }

    // MARK: - Private Methods

    private func getPresignedURL(
        patientId: String,
        fileType: FileType,
        contentType: String
    ) async throws -> PresignedURLResponse {
        let token = try await authService.getAccessToken()

        var request = URLRequest(url: URL(string: "\(apiBaseURL)/upload/presigned-url")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "patientId": patientId,
            "fileType": fileType.apiValue,
            "contentType": contentType
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw UploadError.presignedURLFailed
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        guard let uploadURL = json?["uploadUrl"] as? String,
              let s3Key = json?["s3Key"] as? String,
              let expiresIn = json?["expiresIn"] as? Int else {
            throw UploadError.presignedURLFailed
        }

        return PresignedURLResponse(
            uploadURL: uploadURL,
            s3Key: s3Key,
            expiresIn: expiresIn
        )
    }

    private func uploadToS3(
        url: String,
        data: Data,
        contentType: String,
        progressHandler: ((Double) -> Void)?
    ) async throws {
        guard let uploadURL = URL(string: url) else {
            throw UploadError.invalidURL
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw UploadError.uploadFailed("S3 upload failed")
        }
    }
}

// MARK: - Supporting Types

/// File types supported for upload.
enum FileType: String, CaseIterable {
    case prescription
    case woundPhoto = "wound_photo"
    case urinePhoto = "urine_photo"
    case stoolPhoto = "stool_photo"
    case vomitPhoto = "vomit_photo"
    case medicalPhoto = "medical_photo"
    case voiceNote = "voice_note"
    case videoNote = "video_note"
    case document

    var apiValue: String { rawValue }

    /// Convert to DocumentType for FHIR storage.
    func toDocumentType() -> DocumentType {
        switch self {
        case .prescription: return .prescription
        case .woundPhoto, .urinePhoto, .stoolPhoto, .vomitPhoto, .medicalPhoto: return .imaging
        case .voiceNote, .videoNote: return .other
        case .document: return .other
        }
    }

    var fhirCode: String {
        switch self {
        case .prescription: return "prescription"
        case .woundPhoto: return "wound-photo"
        case .urinePhoto: return "urine-photo"
        case .stoolPhoto: return "stool-photo"
        case .vomitPhoto: return "vomit-photo"
        case .medicalPhoto: return "medical-photo"
        case .voiceNote: return "voice-note"
        case .videoNote: return "video-note"
        case .document: return "document"
        }
    }

    var displayName: String {
        switch self {
        case .prescription: return "Prescription"
        case .woundPhoto: return "Wound Photo"
        case .urinePhoto: return "Urine Photo"
        case .stoolPhoto: return "Stool Photo"
        case .vomitPhoto: return "Vomit Photo"
        case .medicalPhoto: return "Medical Photo"
        case .voiceNote: return "Voice Note"
        case .videoNote: return "Video Note"
        case .document: return "Document"
        }
    }
}

/// Presigned URL response from API.
struct PresignedURLResponse {
    let uploadURL: String
    let s3Key: String
    let expiresIn: Int
}

/// Upload result.
struct UploadResult {
    let documentId: String
    let s3Key: String
}

/// Upload errors.
enum UploadError: LocalizedError {
    case notAuthenticated
    case invalidData
    case invalidURL
    case presignedURLFailed
    case uploadFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Not authenticated"
        case .invalidData:
            return "Invalid data"
        case .invalidURL:
            return "Invalid URL"
        case .presignedURLFailed:
            return "Failed to get upload URL"
        case .uploadFailed(let message):
            return message
        }
    }
}
