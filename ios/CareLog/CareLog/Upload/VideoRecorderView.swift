import SwiftUI
import AVFoundation
import AVKit

/// Video note recording view.
struct VideoRecorderView: View {
    let onRecordingComplete: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var recordedVideoURL: URL?
    @State private var showPreview = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ZStack {
                if showPreview, let url = recordedVideoURL {
                    VideoPreviewView(
                        url: url,
                        onRetake: {
                            deleteVideo()
                            showPreview = false
                        },
                        onUse: {
                            onRecordingComplete(url)
                            dismiss()
                        }
                    )
                } else {
                    VideoRecordingView(
                        onRecordingComplete: { url in
                            recordedVideoURL = url
                            showPreview = true
                        },
                        onError: { errorMessage in
                            error = errorMessage
                        }
                    )
                }
            }
            .navigationTitle("Video Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        deleteVideo()
                        dismiss()
                    }
                }
            }
            .alert("Recording Error", isPresented: .constant(error != nil)) {
                Button("OK") {
                    error = nil
                    dismiss()
                }
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func deleteVideo() {
        if let url = recordedVideoURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordedVideoURL = nil
    }
}

// MARK: - Video Recording View

struct VideoRecordingView: UIViewControllerRepresentable {
    let onRecordingComplete: (URL) -> Void
    let onError: (String) -> Void

    func makeUIViewController(context: Context) -> VideoRecordingViewController {
        let controller = VideoRecordingViewController()
        controller.onRecordingComplete = onRecordingComplete
        controller.onError = onError
        return controller
    }

    func updateUIViewController(_ uiViewController: VideoRecordingViewController, context: Context) {}
}

// MARK: - Video Recording View Controller

final class VideoRecordingViewController: UIViewController {
    var onRecordingComplete: ((URL) -> Void)?
    var onError: ((String) -> Void)?

    private var captureSession: AVCaptureSession?
    private var movieOutput: AVCaptureMovieFileOutput?
    private var previewLayer: AVCaptureVideoPreviewLayer?

    private var isRecording = false
    private var recordingStartTime: Date?
    private var displayLink: CADisplayLink?

    private let maxRecordingDuration: TimeInterval = 120 // 2 minutes

    private lazy var recordButton: UIButton = {
        let button = UIButton(type: .custom)
        button.backgroundColor = .red
        button.layer.cornerRadius = 35
        button.addTarget(self, action: #selector(toggleRecording), for: .touchUpInside)
        return button
    }()

    private lazy var timerLabel: UILabel = {
        let label = UILabel()
        label.text = "00:00"
        label.textColor = .white
        label.font = .monospacedDigitSystemFont(ofSize: 20, weight: .medium)
        label.textAlignment = .center
        label.backgroundColor = UIColor.black.withAlphaComponent(0.5)
        label.layer.cornerRadius = 8
        label.layer.masksToBounds = true
        return label
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
        checkAuthorization()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func checkAuthorization() {
        // Check camera
        let cameraStatus = AVCaptureDevice.authorizationStatus(for: .video)
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)

        switch (cameraStatus, micStatus) {
        case (.authorized, .authorized):
            setupCamera()
        case (.notDetermined, _):
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted {
                    self?.checkMicrophoneAccess()
                } else {
                    DispatchQueue.main.async {
                        self?.onError?("Camera access denied")
                    }
                }
            }
        case (_, .notDetermined):
            checkMicrophoneAccess()
        default:
            onError?("Camera or microphone access denied. Please enable in Settings.")
        }
    }

    private func checkMicrophoneAccess() {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            DispatchQueue.main.async {
                if granted {
                    self?.setupCamera()
                } else {
                    self?.onError?("Microphone access denied")
                }
            }
        }
    }

    private func setupCamera() {
        let session = AVCaptureSession()
        session.sessionPreset = .high

        // Video input
        guard let videoDevice = getCamera(position: currentCameraPosition),
              let videoInput = try? AVCaptureDeviceInput(device: videoDevice) else {
            onError?("Could not access camera")
            return
        }

        if session.canAddInput(videoInput) {
            session.addInput(videoInput)
        }

        // Audio input
        if let audioDevice = AVCaptureDevice.default(for: .audio),
           let audioInput = try? AVCaptureDeviceInput(device: audioDevice) {
            if session.canAddInput(audioInput) {
                session.addInput(audioInput)
            }
        }

        // Movie output
        let output = AVCaptureMovieFileOutput()
        output.maxRecordedDuration = CMTime(seconds: maxRecordingDuration, preferredTimescale: 1)

        if session.canAddOutput(output) {
            session.addOutput(output)
            movieOutput = output
        }

        // Preview layer
        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        view.layer.addSublayer(previewLayer)
        self.previewLayer = previewLayer

        // Setup UI
        setupUI()

        // Start session
        captureSession = session
        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    private func getCamera(position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
    }

    private func setupUI() {
        // Record button
        view.addSubview(recordButton)
        recordButton.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            recordButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            recordButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            recordButton.widthAnchor.constraint(equalToConstant: 70),
            recordButton.heightAnchor.constraint(equalToConstant: 70)
        ])

        // Timer label
        view.addSubview(timerLabel)
        timerLabel.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            timerLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            timerLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            timerLabel.widthAnchor.constraint(equalToConstant: 80),
            timerLabel.heightAnchor.constraint(equalToConstant: 36)
        ])

        // Switch camera button
        view.addSubview(switchCameraButton)
        switchCameraButton.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            switchCameraButton.centerYAnchor.constraint(equalTo: recordButton.centerYAnchor),
            switchCameraButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -30),
            switchCameraButton.widthAnchor.constraint(equalToConstant: 44),
            switchCameraButton.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    @objc private func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        guard let movieOutput = movieOutput else { return }

        let fileName = "video_note_\(Date().timeIntervalSince1970).mp4"
        let outputURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

        movieOutput.startRecording(to: outputURL, recordingDelegate: self)

        isRecording = true
        recordingStartTime = Date()
        updateRecordButtonAppearance()
        startTimer()
        switchCameraButton.isHidden = true
    }

    private func stopRecording() {
        movieOutput?.stopRecording()
        isRecording = false
        updateRecordButtonAppearance()
        stopTimer()
        switchCameraButton.isHidden = false
    }

    private func updateRecordButtonAppearance() {
        UIView.animate(withDuration: 0.2) {
            if self.isRecording {
                self.recordButton.layer.cornerRadius = 8
                self.recordButton.transform = CGAffineTransform(scaleX: 0.6, y: 0.6)
            } else {
                self.recordButton.layer.cornerRadius = 35
                self.recordButton.transform = .identity
            }
        }
    }

    private func startTimer() {
        displayLink = CADisplayLink(target: self, selector: #selector(updateTimer))
        displayLink?.add(to: .main, forMode: .common)
    }

    private func stopTimer() {
        displayLink?.invalidate()
        displayLink = nil
        timerLabel.text = "00:00"
    }

    @objc private func updateTimer() {
        guard let startTime = recordingStartTime else { return }
        let elapsed = Date().timeIntervalSince(startTime)
        let minutes = Int(elapsed) / 60
        let seconds = Int(elapsed) % 60
        timerLabel.text = String(format: "%02d:%02d", minutes, seconds)
    }

    @objc private func switchCamera() {
        guard let session = captureSession else { return }

        session.beginConfiguration()

        // Remove video input
        for input in session.inputs {
            if let deviceInput = input as? AVCaptureDeviceInput,
               deviceInput.device.hasMediaType(.video) {
                session.removeInput(deviceInput)
            }
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

// MARK: - AVCaptureFileOutputRecordingDelegate

extension VideoRecordingViewController: AVCaptureFileOutputRecordingDelegate {
    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        if let error = error {
            onError?(error.localizedDescription)
            return
        }

        onRecordingComplete?(outputFileURL)
    }
}

// MARK: - Video Preview View

struct VideoPreviewView: View {
    let url: URL
    let onRetake: () -> Void
    let onUse: () -> Void

    @State private var player: AVPlayer?

    var body: some View {
        VStack(spacing: 0) {
            // Video player
            if let player = player {
                VideoPlayer(player: player)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onAppear {
                        player.play()
                    }
            }

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
                        Text("Use Video")
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
        .background(Color.black)
        .onAppear {
            player = AVPlayer(url: url)
            NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime,
                object: player?.currentItem,
                queue: .main
            ) { _ in
                player?.seek(to: .zero)
                player?.play()
            }
        }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }
}

// MARK: - Preview

#Preview {
    VideoRecorderView { _ in }
}
