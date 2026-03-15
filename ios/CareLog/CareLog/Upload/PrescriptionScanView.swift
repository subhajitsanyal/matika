import SwiftUI
import VisionKit
import PhotosUI

/// Prescription scan view with document scanner and file picker.
struct PrescriptionScanView: View {
    let onDocumentCaptured: (Data, String) -> Void // (data, contentType)
    @Environment(\.dismiss) private var dismiss

    @State private var showScanner = false
    @State private var showFilePicker = false
    @State private var showPhotoPicker = false
    @State private var capturedImage: UIImage?
    @State private var showPreview = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                // Icon
                Image(systemName: "doc.text.viewfinder")
                    .font(.system(size: 80))
                    .foregroundColor(CareLogColors.primary)

                Text("Scan or Upload Prescription")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Choose how you'd like to add your prescription")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Spacer()

                // Options
                VStack(spacing: 16) {
                    // Scan document
                    if VNDocumentCameraViewController.isSupported {
                        OptionButton(
                            icon: "doc.viewfinder",
                            title: "Scan Document",
                            subtitle: "Use camera to scan",
                            color: CareLogColors.primary
                        ) {
                            showScanner = true
                        }
                    }

                    // Choose from gallery
                    PhotosPicker(
                        selection: $selectedPhotoItem,
                        matching: .images
                    ) {
                        OptionButton(
                            icon: "photo.on.rectangle",
                            title: "Choose from Gallery",
                            subtitle: "Select existing photo",
                            color: CareLogColors.glucose
                        )
                    }
                    .buttonStyle(.plain)

                    // Choose file
                    OptionButton(
                        icon: "doc.fill",
                        title: "Upload PDF",
                        subtitle: "Select from files",
                        color: CareLogColors.spO2
                    ) {
                        showFilePicker = true
                    }
                }
                .padding(.horizontal)

                Spacer()
            }
            .navigationTitle("Prescription")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showScanner) {
                DocumentScannerView { images in
                    if let firstImage = images.first {
                        capturedImage = firstImage
                        showPreview = true
                    }
                }
            }
            .sheet(isPresented: $showFilePicker) {
                DocumentPickerView { url in
                    handleFileSelection(url)
                }
            }
            .fullScreenCover(isPresented: $showPreview) {
                if let image = capturedImage {
                    ImagePreviewView(
                        image: image,
                        onRetake: {
                            showPreview = false
                            capturedImage = nil
                        },
                        onUse: {
                            if let data = image.jpegData(compressionQuality: 0.8) {
                                onDocumentCaptured(data, "image/jpeg")
                                dismiss()
                            }
                        }
                    )
                }
            }
            .onChange(of: selectedPhotoItem) { _, newItem in
                Task {
                    if let item = newItem,
                       let data = try? await item.loadTransferable(type: Data.self),
                       let image = UIImage(data: data) {
                        capturedImage = image
                        showPreview = true
                    }
                }
            }
            .alert("Error", isPresented: .constant(error != nil)) {
                Button("OK") {
                    error = nil
                }
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func handleFileSelection(_ url: URL) {
        do {
            guard url.startAccessingSecurityScopedResource() else {
                error = "Could not access file"
                return
            }
            defer { url.stopAccessingSecurityScopedResource() }

            let data = try Data(contentsOf: url)
            let contentType = url.pathExtension.lowercased() == "pdf" ? "application/pdf" : "image/jpeg"
            onDocumentCaptured(data, contentType)
            dismiss()
        } catch {
            self.error = "Could not read file: \(error.localizedDescription)"
        }
    }
}

// MARK: - Option Button

struct OptionButton<Content: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    let color: Color
    var action: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    init(
        icon: String,
        title: String,
        subtitle: String,
        color: Color,
        action: @escaping () -> Void
    ) where Content == EmptyView {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.color = color
        self.action = action
        self.content = { EmptyView() }
    }

    init(
        icon: String,
        title: String,
        subtitle: String,
        color: Color
    ) where Content == EmptyView {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.color = color
        self.action = nil
        self.content = { EmptyView() }
    }

    var body: some View {
        Button(action: { action?() }) {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(color.opacity(0.15))
                        .frame(width: 56, height: 56)

                    Image(systemName: icon)
                        .font(.title2)
                        .foregroundColor(color)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                        .foregroundColor(.primary)

                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(16)
            .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Document Scanner View

struct DocumentScannerView: UIViewControllerRepresentable {
    let onScan: ([UIImage]) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let scanner = VNDocumentCameraViewController()
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onScan: ([UIImage]) -> Void

        init(onScan: @escaping ([UIImage]) -> Void) {
            self.onScan = onScan
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            var images: [UIImage] = []
            for index in 0..<scan.pageCount {
                images.append(scan.imageOfPage(at: index))
            }
            controller.dismiss(animated: true) {
                self.onScan(images)
            }
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            controller.dismiss(animated: true)
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            controller.dismiss(animated: true)
        }
    }
}

// MARK: - Image Preview View

struct ImagePreviewView: View {
    let image: UIImage
    let onRetake: () -> Void
    let onUse: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Image preview
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black)

                // Action buttons
                HStack(spacing: 40) {
                    Button(action: {
                        dismiss()
                        onRetake()
                    }) {
                        VStack {
                            Image(systemName: "arrow.counterclockwise")
                                .font(.title)
                            Text("Retake")
                                .font(.caption)
                        }
                        .foregroundColor(.white)
                        .frame(width: 80, height: 60)
                    }

                    Button(action: onUse) {
                        VStack {
                            Image(systemName: "checkmark")
                                .font(.title)
                            Text("Use Photo")
                                .font(.caption)
                        }
                        .foregroundColor(.white)
                        .frame(width: 80, height: 60)
                        .background(CareLogColors.primary)
                        .cornerRadius(12)
                    }
                }
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
                .background(Color.black.opacity(0.9))
            }
            .navigationTitle("Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - Preview

#Preview {
    PrescriptionScanView { _, _ in }
}
