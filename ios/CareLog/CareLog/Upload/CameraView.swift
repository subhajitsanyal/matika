import SwiftUI
import AVFoundation

/// Camera capture view for medical photos.
struct CameraView: View {
    let fileType: FileType
    let onImageCaptured: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var capturedImage: UIImage?
    @State private var showPreview = false
    @State private var cameraError: String?

    var body: some View {
        NavigationStack {
            ZStack {
                if showPreview, let image = capturedImage {
                    // Preview captured image
                    PreviewView(
                        image: image,
                        onRetake: {
                            showPreview = false
                            capturedImage = nil
                        },
                        onUse: {
                            onImageCaptured(image)
                            dismiss()
                        }
                    )
                } else {
                    // Camera view
                    CameraCaptureView(
                        onCapture: { image in
                            capturedImage = image
                            showPreview = true
                        },
                        onError: { error in
                            cameraError = error
                        }
                    )
                }
            }
            .navigationTitle(fileType.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Camera Error", isPresented: .constant(cameraError != nil)) {
                Button("OK") {
                    cameraError = nil
                    dismiss()
                }
            } message: {
                Text(cameraError ?? "")
            }
        }
    }
}

// MARK: - Preview View

struct PreviewView: View {
    let image: UIImage
    let onRetake: () -> Void
    let onUse: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Image preview
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)

            // Action buttons
            HStack(spacing: 40) {
                Button(action: onRetake) {
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
    }
}

// MARK: - Camera Capture View

struct CameraCaptureView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    let onError: (String) -> Void

    func makeUIViewController(context: Context) -> CameraCaptureViewController {
        let controller = CameraCaptureViewController()
        controller.onCapture = onCapture
        controller.onError = onError
        return controller
    }

    func updateUIViewController(_ uiViewController: CameraCaptureViewController, context: Context) {}
}

// MARK: - Camera Capture View Controller

final class CameraCaptureViewController: UIViewController {
    var onCapture: ((UIImage) -> Void)?
    var onError: ((String) -> Void)?

    private var captureSession: AVCaptureSession?
    private var photoOutput: AVCapturePhotoOutput?
    private var previewLayer: AVCaptureVideoPreviewLayer?

    private lazy var captureButton: UIButton = {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: "circle.fill"), for: .normal)
        button.tintColor = .white
        button.contentVerticalAlignment = .fill
        button.contentHorizontalAlignment = .fill
        button.addTarget(self, action: #selector(capturePhoto), for: .touchUpInside)
        return button
    }()

    private lazy var switchCameraButton: UIButton = {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: "camera.rotate"), for: .normal)
        button.tintColor = .white
        button.addTarget(self, action: #selector(switchCamera), for: .touchUpInside)
        return button
    }()

    private var currentCameraPosition: AVCaptureDevice.Position = .back

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        checkCameraAuthorization()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func checkCameraAuthorization() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setupCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.setupCamera()
                    } else {
                        self?.onError?("Camera access denied")
                    }
                }
            }
        case .denied, .restricted:
            onError?("Camera access denied. Please enable in Settings.")
        @unknown default:
            onError?("Unknown camera authorization status")
        }
    }

    private func setupCamera() {
        let session = AVCaptureSession()
        session.sessionPreset = .photo

        // Get camera device
        guard let camera = getCamera(position: currentCameraPosition),
              let input = try? AVCaptureDeviceInput(device: camera) else {
            onError?("Could not access camera")
            return
        }

        // Add input
        if session.canAddInput(input) {
            session.addInput(input)
        }

        // Add photo output
        let output = AVCapturePhotoOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            photoOutput = output
        }

        // Setup preview layer
        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        view.layer.addSublayer(previewLayer)
        self.previewLayer = previewLayer

        // Add capture button
        setupCaptureButton()

        // Start session
        captureSession = session
        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    private func getCamera(position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
    }

    private func setupCaptureButton() {
        view.addSubview(captureButton)
        captureButton.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            captureButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            captureButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            captureButton.widthAnchor.constraint(equalToConstant: 70),
            captureButton.heightAnchor.constraint(equalToConstant: 70)
        ])

        view.addSubview(switchCameraButton)
        switchCameraButton.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            switchCameraButton.centerYAnchor.constraint(equalTo: captureButton.centerYAnchor),
            switchCameraButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -30),
            switchCameraButton.widthAnchor.constraint(equalToConstant: 44),
            switchCameraButton.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    @objc private func capturePhoto() {
        let settings = AVCapturePhotoSettings()
        photoOutput?.capturePhoto(with: settings, delegate: self)
    }

    @objc private func switchCamera() {
        guard let session = captureSession else { return }

        session.beginConfiguration()

        // Remove current input
        if let currentInput = session.inputs.first as? AVCaptureDeviceInput {
            session.removeInput(currentInput)
        }

        // Switch position
        currentCameraPosition = currentCameraPosition == .back ? .front : .back

        // Add new input
        if let camera = getCamera(position: currentCameraPosition),
           let newInput = try? AVCaptureDeviceInput(device: camera) {
            if session.canAddInput(newInput) {
                session.addInput(newInput)
            }
        }

        session.commitConfiguration()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureSession?.stopRunning()
    }
}

// MARK: - AVCapturePhotoCaptureDelegate

extension CameraCaptureViewController: AVCapturePhotoCaptureDelegate {
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error = error {
            onError?(error.localizedDescription)
            return
        }

        guard let imageData = photo.fileDataRepresentation(),
              let image = UIImage(data: imageData) else {
            onError?("Could not process photo")
            return
        }

        // Fix orientation for front camera
        let finalImage: UIImage
        if currentCameraPosition == .front {
            finalImage = image.withHorizontallyFlippedOrientation()
        } else {
            finalImage = image
        }

        onCapture?(finalImage)
    }
}

// MARK: - Preview

#Preview {
    CameraView(fileType: .woundPhoto) { _ in }
}
