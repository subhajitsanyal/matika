import Foundation
import SwiftUI
import PhotosUI

/// ViewModel for upload screen.
@MainActor
final class UploadViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var selectedFileType: FileType = .medicalPhoto
    @Published var isUploading: Bool = false
    @Published var uploadProgress: Double?
    @Published var uploadSuccess: Bool = false
    @Published var error: String?

    // MARK: - Dependencies

    private let uploadService = UploadService.shared

    // MARK: - Upload Methods

    func uploadDocument(url: URL) async {
        isUploading = true
        error = nil

        do {
            // Start accessing security-scoped resource
            guard url.startAccessingSecurityScopedResource() else {
                throw UploadError.invalidData
            }
            defer { url.stopAccessingSecurityScopedResource() }

            let data = try Data(contentsOf: url)
            let contentType = url.pathExtension == "pdf" ? "application/pdf" : "image/jpeg"

            _ = try await uploadService.uploadFile(
                data: data,
                fileType: .prescription,
                contentType: contentType,
                description: "Prescription"
            ) { [weak self] progress in
                Task { @MainActor in
                    self?.uploadProgress = progress
                }
            }

            isUploading = false
            uploadProgress = nil
            uploadSuccess = true

        } catch {
            isUploading = false
            uploadProgress = nil
            self.error = error.localizedDescription
        }
    }

    func uploadPrescriptionData(data: Data, contentType: String) async {
        isUploading = true
        error = nil

        do {
            _ = try await uploadService.uploadFile(
                data: data,
                fileType: .prescription,
                contentType: contentType,
                description: "Prescription"
            ) { [weak self] progress in
                Task { @MainActor in
                    self?.uploadProgress = progress
                }
            }

            isUploading = false
            uploadProgress = nil
            uploadSuccess = true

        } catch {
            isUploading = false
            uploadProgress = nil
            self.error = error.localizedDescription
        }
    }

    func uploadPhotoPickerItem(_ item: PhotosPickerItem) async {
        isUploading = true
        error = nil

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw UploadError.invalidData
            }

            _ = try await uploadService.uploadFile(
                data: data,
                fileType: selectedFileType,
                contentType: "image/jpeg",
                description: selectedFileType.displayName
            ) { [weak self] progress in
                Task { @MainActor in
                    self?.uploadProgress = progress
                }
            }

            isUploading = false
            uploadProgress = nil
            uploadSuccess = true

        } catch {
            isUploading = false
            uploadProgress = nil
            self.error = error.localizedDescription
        }
    }

    func uploadImage(_ image: UIImage) async {
        isUploading = true
        error = nil

        do {
            _ = try await uploadService.uploadImage(
                image: image,
                fileType: selectedFileType,
                description: selectedFileType.displayName
            ) { [weak self] progress in
                Task { @MainActor in
                    self?.uploadProgress = progress
                }
            }

            isUploading = false
            uploadProgress = nil
            uploadSuccess = true

        } catch {
            isUploading = false
            uploadProgress = nil
            self.error = error.localizedDescription
        }
    }

    func uploadAudio(url: URL) async {
        isUploading = true
        error = nil

        do {
            let data = try Data(contentsOf: url)

            _ = try await uploadService.uploadFile(
                data: data,
                fileType: .voiceNote,
                contentType: "audio/mp4",
                description: "Voice Note"
            ) { [weak self] progress in
                Task { @MainActor in
                    self?.uploadProgress = progress
                }
            }

            isUploading = false
            uploadProgress = nil
            uploadSuccess = true

        } catch {
            isUploading = false
            uploadProgress = nil
            self.error = error.localizedDescription
        }
    }

    func uploadVideo(url: URL) async {
        isUploading = true
        error = nil

        do {
            let data = try Data(contentsOf: url)

            _ = try await uploadService.uploadFile(
                data: data,
                fileType: .videoNote,
                contentType: "video/mp4",
                description: "Video Note"
            ) { [weak self] progress in
                Task { @MainActor in
                    self?.uploadProgress = progress
                }
            }

            isUploading = false
            uploadProgress = nil
            uploadSuccess = true

        } catch {
            isUploading = false
            uploadProgress = nil
            self.error = error.localizedDescription
        }
    }

    func clearError() {
        error = nil
    }
}
