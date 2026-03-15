import Foundation
import Security
import CryptoKit

/// Certificate pinning manager for API Gateway.
/// Prevents MITM attacks by validating server certificates.
final class CertificatePinning: NSObject {

    static let shared = CertificatePinning()

    // API Gateway domain
    private let apiDomain = "api.carelog.health"

    // SHA-256 certificate pins (base64 encoded)
    private let pinnedCertificates: Set<String> = [
        // Primary certificate pin
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        // Backup certificate pin (for rotation)
        "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
    ]

    private override init() {
        super.init()
    }

    /// Create URLSession with certificate pinning.
    func createPinnedSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        configuration.waitsForConnectivity = true

        return URLSession(
            configuration: configuration,
            delegate: self,
            delegateQueue: nil
        )
    }

    /// Validate certificate against pinned values.
    private func validateCertificate(_ serverTrust: SecTrust, for host: String) -> Bool {
        // Verify host matches expected domain
        guard host == apiDomain || host.hasSuffix(".\(apiDomain)") else {
            return false
        }

        // Get certificate chain
        guard let certificateChain = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate],
              !certificateChain.isEmpty else {
            return false
        }

        // Check each certificate in chain
        for certificate in certificateChain {
            let certificateData = SecCertificateCopyData(certificate) as Data
            let hash = SHA256.hash(data: certificateData)
            let hashString = Data(hash).base64EncodedString()

            if pinnedCertificates.contains(hashString) {
                return true
            }
        }

        return false
    }
}

// MARK: - URLSessionDelegate

extension CertificatePinning: URLSessionDelegate {

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        let host = challenge.protectionSpace.host

        // Perform standard trust evaluation
        var error: CFError?
        let isValid = SecTrustEvaluateWithError(serverTrust, &error)

        guard isValid else {
            print("Certificate trust evaluation failed: \(error?.localizedDescription ?? "unknown")")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Validate against pinned certificates
        guard validateCertificate(serverTrust, for: host) else {
            print("Certificate pinning validation failed for host: \(host)")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Certificate is valid and pinned
        let credential = URLCredential(trust: serverTrust)
        completionHandler(.useCredential, credential)
    }
}

// MARK: - URLSessionTaskDelegate

extension CertificatePinning: URLSessionTaskDelegate {

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        urlSession(session, didReceive: challenge, completionHandler: completionHandler)
    }
}

// MARK: - API Client Extension

extension URLSession {

    /// Shared pinned session for API calls.
    static var pinned: URLSession {
        CertificatePinning.shared.createPinnedSession()
    }
}
