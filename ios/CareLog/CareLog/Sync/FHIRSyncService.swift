import Foundation
import BackgroundTasks
import Combine

/// FHIR sync service for iOS.
///
/// Uses BGTaskScheduler for background sync.
/// Processes sync queue when WiFi is available.
final class FHIRSyncService {
    static let shared = FHIRSyncService()

    // MARK: - Constants

    private static let syncTaskIdentifier = "com.carelog.fhirsync"
    private static let refreshTaskIdentifier = "com.carelog.fhirrefresh"

    // MARK: - Dependencies

    private let networkMonitor = NetworkMonitor.shared
    private let localFHIRRepository = LocalFHIRRepository.shared
    private let healthLakeClient = HealthLakeFHIRClient.shared

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Sync State

    @Published private(set) var isSyncing: Bool = false
    @Published private(set) var lastSyncDate: Date?
    @Published private(set) var pendingCount: Int = 0

    // MARK: - Initialization

    private init() {
        setupNetworkObserver()
    }

    // MARK: - Background Task Registration

    /// Register background tasks. Call from AppDelegate.
    func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.syncTaskIdentifier,
            using: nil
        ) { task in
            self.handleSyncTask(task as! BGProcessingTask)
        }

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.refreshTaskIdentifier,
            using: nil
        ) { task in
            self.handleRefreshTask(task as! BGAppRefreshTask)
        }
    }

    /// Schedule background sync. Call when app enters background.
    func scheduleBackgroundSync() {
        scheduleProcessingTask()
        scheduleAppRefresh()
    }

    // MARK: - Manual Sync

    /// Trigger immediate sync if network is available.
    func triggerSync() async {
        guard networkMonitor.isConnected else { return }
        await performSync()
    }

    /// Trigger sync only on WiFi.
    func triggerWiFiSync() async {
        guard networkMonitor.isWiFi else { return }
        await performSync()
    }

    // MARK: - Private Methods

    private func setupNetworkObserver() {
        networkMonitor.wifiAvailablePublisher
            .sink { [weak self] isWiFiAvailable in
                if isWiFiAvailable {
                    Task {
                        await self?.performSync()
                    }
                }
            }
            .store(in: &cancellables)
    }

    private func performSync() async {
        guard !isSyncing else { return }

        await MainActor.run {
            isSyncing = true
        }

        do {
            // Sync pending observations
            let pendingObservations = try await localFHIRRepository.getPendingObservations()

            for observation in pendingObservations {
                do {
                    let fhirJSON = try observation.toFHIRJSON()

                    if observation.serverId == nil {
                        // New observation - POST
                        let serverId = try await healthLakeClient.createObservation(fhirJSON)
                        try await localFHIRRepository.markObservationSynced(
                            id: observation.id,
                            serverId: serverId
                        )
                    } else {
                        // Updated observation - PUT
                        try await healthLakeClient.updateObservation(
                            id: observation.serverId!,
                            json: fhirJSON
                        )
                        try await localFHIRRepository.markObservationSynced(
                            id: observation.id,
                            serverId: observation.serverId!
                        )
                    }
                } catch {
                    try? await localFHIRRepository.markObservationFailed(
                        id: observation.id,
                        error: error.localizedDescription
                    )
                }
            }

            // Sync pending documents
            let pendingDocuments = try await localFHIRRepository.getPendingDocuments()

            for document in pendingDocuments {
                do {
                    let fhirJSON = try document.toFHIRJSON()

                    if document.serverId == nil {
                        let serverId = try await healthLakeClient.createDocumentReference(fhirJSON)
                        try await localFHIRRepository.markDocumentSynced(
                            id: document.id,
                            serverId: serverId
                        )
                    } else {
                        try await healthLakeClient.updateDocumentReference(
                            id: document.serverId!,
                            json: fhirJSON
                        )
                        try await localFHIRRepository.markDocumentSynced(
                            id: document.id,
                            serverId: document.serverId!
                        )
                    }
                } catch {
                    try? await localFHIRRepository.markDocumentFailed(
                        id: document.id,
                        error: error.localizedDescription
                    )
                }
            }

            await MainActor.run {
                lastSyncDate = Date()
            }

        } catch {
            // Log error
            print("Sync failed: \(error)")
        }

        await MainActor.run {
            isSyncing = false
        }

        // Update pending count
        await updatePendingCount()
    }

    private func updatePendingCount() async {
        let count = await localFHIRRepository.getPendingCount()
        await MainActor.run {
            pendingCount = count
        }
    }

    // MARK: - Background Task Handlers

    private func handleSyncTask(_ task: BGProcessingTask) {
        scheduleProcessingTask() // Schedule next occurrence

        let syncTask = Task {
            await performSync()
        }

        task.expirationHandler = {
            syncTask.cancel()
        }

        Task {
            await syncTask.value
            task.setTaskCompleted(success: true)
        }
    }

    private func handleRefreshTask(_ task: BGAppRefreshTask) {
        scheduleAppRefresh() // Schedule next occurrence

        let refreshTask = Task {
            await updatePendingCount()
        }

        task.expirationHandler = {
            refreshTask.cancel()
        }

        Task {
            await refreshTask.value
            task.setTaskCompleted(success: true)
        }
    }

    private func scheduleProcessingTask() {
        let request = BGProcessingTaskRequest(identifier: Self.syncTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("Failed to schedule processing task: \(error)")
        }
    }

    private func scheduleAppRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60) // 1 hour

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("Failed to schedule app refresh: \(error)")
        }
    }
}
