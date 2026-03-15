import Foundation
import os.log

/// PHI (Protected Health Information) sanitizer for logs and crash reports.
/// Ensures HIPAA compliance by removing or masking sensitive data.
enum PhiSanitizer {

    // MARK: - Patterns

    private static let emailPattern = try! NSRegularExpression(
        pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
        options: []
    )

    private static let phonePattern = try! NSRegularExpression(
        pattern: "\\+?[0-9]{1,4}?[-.\\s]?\\(?[0-9]{1,3}?\\)?[-.\\s]?[0-9]{1,4}[-.\\s]?[0-9]{1,4}[-.\\s]?[0-9]{1,9}",
        options: []
    )

    private static let ssnPattern = try! NSRegularExpression(
        pattern: "\\d{3}[- ]?\\d{2}[- ]?\\d{4}",
        options: []
    )

    private static let dobPattern = try! NSRegularExpression(
        pattern: "(\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4})|(\\d{4}[/\\-]\\d{1,2}[/\\-]\\d{1,2})",
        options: []
    )

    private static let uuidPattern = try! NSRegularExpression(
        pattern: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        options: .caseInsensitive
    )

    // MARK: - Sensitive Fields

    private static let sensitiveFields: Set<String> = [
        "name", "email", "phone", "address", "ssn", "dob", "dateOfBirth",
        "password", "token", "accessToken", "refreshToken", "authorization",
        "patientName", "doctorName", "attendantName", "relativeName",
        "conditions", "diagnosis", "medication"
    ]

    // MARK: - Replacement Strings

    private static let redacted = "[REDACTED]"
    private static let maskedEmail = "[EMAIL]"
    private static let maskedPhone = "[PHONE]"
    private static let maskedSsn = "[SSN]"
    private static let maskedDob = "[DOB]"
    private static let maskedUuid = "[UUID]"

    // MARK: - Sanitization

    /// Sanitize a string by removing PHI.
    static func sanitize(_ message: String) -> String {
        var sanitized = message
        let range = NSRange(sanitized.startIndex..., in: sanitized)

        // Mask emails
        sanitized = emailPattern.stringByReplacingMatches(
            in: sanitized,
            range: range,
            withTemplate: maskedEmail
        )

        // Mask phone numbers
        let phoneRange = NSRange(sanitized.startIndex..., in: sanitized)
        sanitized = phonePattern.stringByReplacingMatches(
            in: sanitized,
            range: phoneRange,
            withTemplate: maskedPhone
        )

        // Mask SSNs
        let ssnRange = NSRange(sanitized.startIndex..., in: sanitized)
        sanitized = ssnPattern.stringByReplacingMatches(
            in: sanitized,
            range: ssnRange,
            withTemplate: maskedSsn
        )

        // Mask dates
        let dobRange = NSRange(sanitized.startIndex..., in: sanitized)
        sanitized = dobPattern.stringByReplacingMatches(
            in: sanitized,
            range: dobRange,
            withTemplate: maskedDob
        )

        // Mask UUIDs
        let uuidRange = NSRange(sanitized.startIndex..., in: sanitized)
        sanitized = uuidPattern.stringByReplacingMatches(
            in: sanitized,
            range: uuidRange,
            withTemplate: maskedUuid
        )

        return sanitized
    }

    /// Sanitize a dictionary by removing PHI from values.
    static func sanitize(_ dictionary: [String: Any]) -> [String: Any] {
        var sanitized = [String: Any]()

        for (key, value) in dictionary {
            if sensitiveFields.contains(where: { key.localizedCaseInsensitiveContains($0) }) {
                sanitized[key] = redacted
            } else if let stringValue = value as? String {
                sanitized[key] = sanitize(stringValue)
            } else if let dictValue = value as? [String: Any] {
                sanitized[key] = sanitize(dictValue)
            } else {
                sanitized[key] = value
            }
        }

        return sanitized
    }

    // MARK: - Safe Logging

    private static let logger = Logger(subsystem: "com.carelog", category: "Sanitized")

    /// Log debug message with PHI sanitization.
    static func logDebug(_ message: String) {
        #if DEBUG
        logger.debug("\(sanitize(message), privacy: .public)")
        #endif
    }

    /// Log info message with PHI sanitization.
    static func logInfo(_ message: String) {
        logger.info("\(sanitize(message), privacy: .public)")
    }

    /// Log warning message with PHI sanitization.
    static func logWarning(_ message: String) {
        logger.warning("\(sanitize(message), privacy: .public)")
    }

    /// Log error message with PHI sanitization.
    static func logError(_ message: String, error: Error? = nil) {
        let sanitizedMessage = sanitize(message)
        if let error = error {
            let sanitizedError = sanitize(error.localizedDescription)
            logger.error("\(sanitizedMessage, privacy: .public): \(sanitizedError, privacy: .public)")
        } else {
            logger.error("\(sanitizedMessage, privacy: .public)")
        }
    }

    // MARK: - Crash Report Data

    /// Create sanitized crash report data.
    static func createCrashData(
        error: Error,
        additionalData: [String: Any] = [:]
    ) -> [String: Any] {
        let nsError = error as NSError

        return [
            "error_domain": nsError.domain,
            "error_code": nsError.code,
            "error_message": sanitize(nsError.localizedDescription),
            "additional_data": sanitize(additionalData)
        ]
    }
}

// MARK: - String Extension

extension String {
    /// Returns a PHI-sanitized version of the string.
    var sanitized: String {
        PhiSanitizer.sanitize(self)
    }
}
