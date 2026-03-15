import SwiftUI

/// Sync status indicator for dashboard.
///
/// Shows: "All synced" / "X pending" / "Sync error"
/// Tap for details or manual sync trigger.
struct SyncStatusIndicator: View {
    @StateObject private var viewModel = SyncStatusViewModel()
    var onTap: () -> Void = {}

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                statusIcon
                    .font(.system(size: 14))

                Text(statusText)
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .foregroundColor(statusColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(statusColor.opacity(0.1))
            .cornerRadius(16)
        }
    }

    private var statusIcon: some View {
        Group {
            switch viewModel.status {
            case .synced:
                Image(systemName: "checkmark.icloud.fill")
            case .syncing:
                Image(systemName: "arrow.triangle.2.circlepath.icloud")
                    .rotationEffect(.degrees(viewModel.isSyncing ? 360 : 0))
                    .animation(
                        viewModel.isSyncing ?
                            .linear(duration: 1).repeatForever(autoreverses: false) :
                            .default,
                        value: viewModel.isSyncing
                    )
            case .pending:
                Image(systemName: "icloud.and.arrow.up")
            case .error:
                Image(systemName: "exclamationmark.icloud.fill")
            case .offline:
                Image(systemName: "wifi.slash")
            }
        }
    }

    private var statusText: String {
        switch viewModel.status {
        case .synced:
            return "All synced"
        case .syncing:
            return "Syncing..."
        case .pending:
            return "\(viewModel.pendingCount) pending"
        case .error:
            return "Sync error"
        case .offline:
            return "Offline"
        }
    }

    private var statusColor: Color {
        switch viewModel.status {
        case .synced:
            return CareLogColors.success
        case .syncing:
            return CareLogColors.info
        case .pending:
            return CareLogColors.warning
        case .error:
            return CareLogColors.error
        case .offline:
            return CareLogColors.onSurfaceVariant
        }
    }
}

/// Sync status detail screen.
struct SyncStatusDetailView: View {
    @StateObject private var viewModel = SyncStatusViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                // Status section
                Section {
                    HStack(spacing: 12) {
                        statusIcon
                            .font(.title)
                            .foregroundColor(statusColor)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(viewModel.status.displayName)
                                .font(.headline)

                            if let lastSync = viewModel.lastSyncTime {
                                Text("Last sync: \(lastSync)")
                                    .font(.caption)
                                    .foregroundColor(CareLogColors.onSurfaceVariant)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }

                // Pending items section
                if viewModel.pendingCount > 0 {
                    Section("Pending Items") {
                        HStack {
                            Text("Observations")
                            Spacer()
                            Text("\(viewModel.pendingObservations)")
                                .foregroundColor(CareLogColors.warning)
                        }

                        HStack {
                            Text("Documents")
                            Spacer()
                            Text("\(viewModel.pendingDocuments)")
                                .foregroundColor(CareLogColors.warning)
                        }
                    }
                }

                // Failed items section
                if viewModel.failedCount > 0 {
                    Section("Failed Items") {
                        HStack {
                            Text("Failed to sync")
                            Spacer()
                            Text("\(viewModel.failedCount)")
                                .foregroundColor(CareLogColors.error)
                        }
                    }
                }

                // Network status section
                Section("Network") {
                    HStack(spacing: 12) {
                        Image(systemName: viewModel.isWiFi ? "wifi" : "antenna.radiowaves.left.and.right")
                            .foregroundColor(viewModel.isConnected ? CareLogColors.success : CareLogColors.onSurfaceVariant)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(networkStatusText)
                                .font(.body)

                            Text(viewModel.isWiFi ? "Sync enabled" : "WiFi required for sync")
                                .font(.caption)
                                .foregroundColor(CareLogColors.onSurfaceVariant)
                        }
                    }
                    .padding(.vertical, 4)
                }

                // Manual sync button
                Section {
                    Button {
                        viewModel.triggerManualSync()
                    } label: {
                        HStack {
                            Spacer()
                            Image(systemName: "arrow.triangle.2.circlepath")
                            Text("Sync Now")
                            Spacer()
                        }
                    }
                    .disabled(viewModel.status == .syncing || viewModel.status == .offline)
                }
            }
            .navigationTitle("Sync Status")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var statusIcon: some View {
        Group {
            switch viewModel.status {
            case .synced:
                Image(systemName: "checkmark.icloud.fill")
            case .syncing:
                Image(systemName: "arrow.triangle.2.circlepath.icloud")
            case .pending:
                Image(systemName: "icloud.and.arrow.up")
            case .error:
                Image(systemName: "exclamationmark.icloud.fill")
            case .offline:
                Image(systemName: "wifi.slash")
            }
        }
    }

    private var statusColor: Color {
        switch viewModel.status {
        case .synced: return CareLogColors.success
        case .syncing: return CareLogColors.info
        case .pending: return CareLogColors.warning
        case .error: return CareLogColors.error
        case .offline: return CareLogColors.onSurfaceVariant
        }
    }

    private var networkStatusText: String {
        if viewModel.isWiFi {
            return "Connected via WiFi"
        } else if viewModel.isConnected {
            return "Connected via mobile data"
        } else {
            return "No connection"
        }
    }
}

// MARK: - ViewModel

@MainActor
final class SyncStatusViewModel: ObservableObject {
    @Published var status: SyncState = .synced
    @Published var pendingCount: Int = 0
    @Published var pendingObservations: Int = 0
    @Published var pendingDocuments: Int = 0
    @Published var failedCount: Int = 0
    @Published var isConnected: Bool = true
    @Published var isWiFi: Bool = false
    @Published var isSyncing: Bool = false
    @Published var lastSyncTime: String?

    private let networkMonitor = NetworkMonitor.shared
    private let syncService = FHIRSyncService.shared
    private let localFHIRRepository = LocalFHIRRepository.shared

    init() {
        setupObservers()
        loadStatus()
    }

    private func setupObservers() {
        networkMonitor.$isConnected
            .assign(to: &$isConnected)

        networkMonitor.$isWiFi
            .assign(to: &$isWiFi)

        syncService.$isSyncing
            .assign(to: &$isSyncing)

        syncService.$pendingCount
            .assign(to: &$pendingCount)
    }

    private func loadStatus() {
        Task {
            await updateStatus()
        }
    }

    private func updateStatus() async {
        let pending = await MainActor.run { (try? localFHIRRepository.getPendingCount()) ?? 0 }
        let failed = await MainActor.run { (try? localFHIRRepository.getFailedCount()) ?? 0 }

        pendingCount = pending
        failedCount = failed

        status = calculateStatus()

        if let date = syncService.lastSyncDate {
            let formatter = DateFormatter()
            formatter.dateStyle = .short
            formatter.timeStyle = .short
            lastSyncTime = formatter.string(from: date)
        }
    }

    private func calculateStatus() -> SyncState {
        if !isConnected {
            return .offline
        } else if isSyncing {
            return .syncing
        } else if failedCount > 0 {
            return .error
        } else if pendingCount > 0 {
            return .pending
        } else {
            return .synced
        }
    }

    func triggerManualSync() {
        Task {
            await syncService.triggerSync()
            await updateStatus()
        }
    }
}

// MARK: - Sync State

enum SyncState {
    case synced
    case syncing
    case pending
    case error
    case offline

    var displayName: String {
        switch self {
        case .synced: return "All Synced"
        case .syncing: return "Syncing"
        case .pending: return "Pending Sync"
        case .error: return "Sync Error"
        case .offline: return "Offline"
        }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 20) {
        SyncStatusIndicator()
        SyncStatusDetailView()
    }
}
