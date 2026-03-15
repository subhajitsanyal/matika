import SwiftUI
import PhotosUI

/// Upload screen with options for different media types.
struct UploadView: View {
    @StateObject private var viewModel = UploadViewModel()
    @Environment(\.dismiss) private var dismiss

    @State private var showDocumentPicker = false
    @State private var showImagePicker = false
    @State private var showCamera = false
    @State private var showVoiceRecorder = false
    @State private var showVideoRecorder = false
    @State private var selectedPhotoItem: PhotosPickerItem?

    var body: some View {
        ZStack {
            ScrollView {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible())],
                    spacing: 16
                ) {
                    ForEach(UploadOption.allOptions) { option in
                        UploadOptionCard(option: option) {
                            handleOptionTap(option)
                        }
                    }
                }
                .padding(16)
            }

            // Upload progress overlay
            if viewModel.isUploading {
                Color.black.opacity(0.5)
                    .ignoresSafeArea()

                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.5)

                    Text("Uploading...")
                        .font(.headline)
                        .foregroundColor(.white)

                    if let progress = viewModel.uploadProgress {
                        ProgressView(value: progress)
                            .frame(width: 200)
                            .tint(.white)
                    }
                }
                .padding(32)
                .background(Color(.systemBackground))
                .cornerRadius(16)
            }
        }
        .navigationTitle("Upload Media")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(CareLogColors.upload, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showDocumentPicker) {
            PrescriptionScanView { data, contentType in
                Task {
                    await viewModel.uploadPrescriptionData(data: data, contentType: contentType)
                }
            }
        }
        .photosPicker(isPresented: $showImagePicker, selection: $selectedPhotoItem)
        .onChange(of: selectedPhotoItem) { _, newItem in
            if let item = newItem {
                Task {
                    await viewModel.uploadPhotoPickerItem(item)
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraView(fileType: viewModel.selectedFileType) { image in
                Task {
                    await viewModel.uploadImage(image)
                }
            }
        }
        .sheet(isPresented: $showVoiceRecorder) {
            VoiceRecorderView { url in
                Task {
                    await viewModel.uploadAudio(url: url)
                }
            }
        }
        .sheet(isPresented: $showVideoRecorder) {
            VideoRecorderView { url in
                Task {
                    await viewModel.uploadVideo(url: url)
                }
            }
        }
        .alert("Error", isPresented: .constant(viewModel.error != nil)) {
            Button("OK") {
                viewModel.clearError()
            }
        } message: {
            Text(viewModel.error ?? "")
        }
        .onChange(of: viewModel.uploadSuccess) { _, success in
            if success {
                dismiss()
            }
        }
    }

    private func handleOptionTap(_ option: UploadOption) {
        viewModel.selectedFileType = option.fileType

        switch option.type {
        case .prescription:
            showDocumentPicker = true
        case .woundPhoto:
            showCamera = true
        case .medicalPhoto:
            showImagePicker = true
        case .voiceNote:
            showVoiceRecorder = true
        case .videoNote:
            showVideoRecorder = true
        case .gallery:
            showImagePicker = true
        }
    }
}

// MARK: - Upload Option Card

struct UploadOptionCard: View {
    let option: UploadOption
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(option.color)
                        .frame(width: 56, height: 56)

                    Image(systemName: option.iconName)
                        .font(.title2)
                        .foregroundColor(.white)
                }

                Text(option.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(CareLogColors.onSurface)

                Text(option.subtitle)
                    .font(.caption)
                    .foregroundColor(CareLogColors.onSurfaceVariant)
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .padding(16)
            .background(option.color.opacity(0.12))
            .cornerRadius(16)
        }
    }
}

// MARK: - Upload Option

struct UploadOption: Identifiable {
    let id = UUID()
    let type: UploadOptionType
    let title: String
    let subtitle: String
    let iconName: String
    let color: Color
    let fileType: FileType

    static let allOptions: [UploadOption] = [
        UploadOption(
            type: .prescription,
            title: "Prescription",
            subtitle: "Scan or upload",
            iconName: "doc.text.fill",
            color: CareLogColors.primary,
            fileType: .prescription
        ),
        UploadOption(
            type: .woundPhoto,
            title: "Wound Photo",
            subtitle: "Take photo",
            iconName: "camera.fill",
            color: CareLogColors.error,
            fileType: .woundPhoto
        ),
        UploadOption(
            type: .medicalPhoto,
            title: "Medical Photo",
            subtitle: "Urine, stool, etc.",
            iconName: "photo.fill",
            color: CareLogColors.warning,
            fileType: .medicalPhoto
        ),
        UploadOption(
            type: .voiceNote,
            title: "Voice Note",
            subtitle: "Record audio",
            iconName: "mic.fill",
            color: CareLogColors.glucose,
            fileType: .voiceNote
        ),
        UploadOption(
            type: .videoNote,
            title: "Video Note",
            subtitle: "Record video",
            iconName: "video.fill",
            color: CareLogColors.spO2,
            fileType: .videoNote
        ),
        UploadOption(
            type: .gallery,
            title: "From Gallery",
            subtitle: "Choose existing",
            iconName: "photo.on.rectangle",
            color: CareLogColors.weight,
            fileType: .medicalPhoto
        )
    ]
}

enum UploadOptionType {
    case prescription
    case woundPhoto
    case medicalPhoto
    case voiceNote
    case videoNote
    case gallery
}

// MARK: - Document Picker View

struct DocumentPickerView: UIViewControllerRepresentable {
    let onDocumentPicked: (URL) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf, .image])
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onDocumentPicked: onDocumentPicked)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onDocumentPicked: (URL) -> Void

        init(onDocumentPicked: @escaping (URL) -> Void) {
            self.onDocumentPicked = onDocumentPicked
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            if let url = urls.first {
                onDocumentPicked(url)
            }
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        UploadView()
    }
}
