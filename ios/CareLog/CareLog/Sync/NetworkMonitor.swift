import Foundation
import Network
import Combine

/// Network connectivity monitor.
///
/// Uses NWPathMonitor to detect network changes.
/// Triggers sync when WiFi becomes available.
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    // MARK: - Published Properties

    @Published private(set) var isConnected: Bool = false
    @Published private(set) var isWiFi: Bool = false
    @Published private(set) var networkType: NetworkType = .unknown

    // MARK: - Private Properties

    private let monitor: NWPathMonitor
    private let queue = DispatchQueue(label: "com.carelog.networkmonitor")
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        monitor = NWPathMonitor()

        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.updateNetworkStatus(path)
            }
        }

        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }

    // MARK: - WiFi Availability Publisher

    /// Publisher that emits when WiFi becomes available.
    var wifiAvailablePublisher: AnyPublisher<Bool, Never> {
        $isWiFi
            .removeDuplicates()
            .eraseToAnyPublisher()
    }

    /// Publisher that emits when any network connection becomes available.
    var connectionAvailablePublisher: AnyPublisher<Bool, Never> {
        $isConnected
            .removeDuplicates()
            .eraseToAnyPublisher()
    }

    // MARK: - Private Methods

    private func updateNetworkStatus(_ path: NWPath) {
        isConnected = path.status == .satisfied

        if path.usesInterfaceType(.wifi) {
            networkType = .wifi
            isWiFi = true
        } else if path.usesInterfaceType(.cellular) {
            networkType = .cellular
            isWiFi = false
        } else if path.usesInterfaceType(.wiredEthernet) {
            networkType = .ethernet
            isWiFi = false
        } else {
            networkType = path.status == .satisfied ? .other : .none
            isWiFi = false
        }
    }
}

// MARK: - Network Type

enum NetworkType {
    case wifi
    case cellular
    case ethernet
    case other
    case none
    case unknown

    var isUnmetered: Bool {
        self == .wifi || self == .ethernet
    }
}
