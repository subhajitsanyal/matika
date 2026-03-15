package com.carelog.util

import android.util.Log
import java.util.regex.Pattern

/**
 * PHI (Protected Health Information) sanitizer for logs and crash reports.
 * Ensures HIPAA compliance by removing or masking sensitive data.
 */
object PhiSanitizer {

    private const val TAG = "PhiSanitizer"

    // Patterns for PHI detection
    private val EMAIL_PATTERN = Pattern.compile(
        "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"
    )

    private val PHONE_PATTERN = Pattern.compile(
        "\\+?[0-9]{1,4}?[-.\\s]?\\(?[0-9]{1,3}?\\)?[-.\\s]?[0-9]{1,4}[-.\\s]?[0-9]{1,4}[-.\\s]?[0-9]{1,9}"
    )

    private val SSN_PATTERN = Pattern.compile(
        "\\d{3}[- ]?\\d{2}[- ]?\\d{4}"
    )

    private val DATE_OF_BIRTH_PATTERN = Pattern.compile(
        "(\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4})|(\\d{4}[/\\-]\\d{1,2}[/\\-]\\d{1,2})"
    )

    private val UUID_PATTERN = Pattern.compile(
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    )

    // Sensitive field names to redact values for
    private val SENSITIVE_FIELDS = setOf(
        "name", "email", "phone", "address", "ssn", "dob", "dateOfBirth",
        "password", "token", "accessToken", "refreshToken", "authorization",
        "patientName", "doctorName", "attendantName", "relativeName",
        "conditions", "diagnosis", "medication"
    )

    // Replacement strings
    private const val REDACTED = "[REDACTED]"
    private const val MASKED_EMAIL = "[EMAIL]"
    private const val MASKED_PHONE = "[PHONE]"
    private const val MASKED_SSN = "[SSN]"
    private const val MASKED_DOB = "[DOB]"
    private const val MASKED_UUID = "[UUID]"

    /**
     * Sanitize a log message by removing PHI.
     */
    fun sanitize(message: String): String {
        var sanitized = message

        // Mask emails
        sanitized = EMAIL_PATTERN.matcher(sanitized).replaceAll(MASKED_EMAIL)

        // Mask phone numbers
        sanitized = PHONE_PATTERN.matcher(sanitized).replaceAll(MASKED_PHONE)

        // Mask SSNs
        sanitized = SSN_PATTERN.matcher(sanitized).replaceAll(MASKED_SSN)

        // Mask dates that could be DOB
        sanitized = DATE_OF_BIRTH_PATTERN.matcher(sanitized).replaceAll(MASKED_DOB)

        // Mask UUIDs (patient IDs, etc.)
        sanitized = UUID_PATTERN.matcher(sanitized).replaceAll(MASKED_UUID)

        return sanitized
    }

    /**
     * Sanitize a map of key-value pairs.
     */
    fun sanitizeMap(data: Map<String, Any?>): Map<String, Any?> {
        return data.mapValues { (key, value) ->
            if (SENSITIVE_FIELDS.any { key.contains(it, ignoreCase = true) }) {
                REDACTED
            } else {
                when (value) {
                    is String -> sanitize(value)
                    is Map<*, *> -> sanitizeMap(value as Map<String, Any?>)
                    else -> value
                }
            }
        }
    }

    /**
     * Safe logging wrapper that sanitizes before logging.
     */
    fun logDebug(tag: String, message: String) {
        if (BuildConfig.DEBUG) {
            Log.d(tag, sanitize(message))
        }
    }

    fun logInfo(tag: String, message: String) {
        Log.i(tag, sanitize(message))
    }

    fun logWarning(tag: String, message: String) {
        Log.w(tag, sanitize(message))
    }

    fun logError(tag: String, message: String, throwable: Throwable? = null) {
        val sanitizedMessage = sanitize(message)
        val sanitizedThrowable = throwable?.let { sanitizeThrowable(it) }
        Log.e(tag, sanitizedMessage, sanitizedThrowable)
    }

    /**
     * Sanitize exception message and stack trace.
     */
    private fun sanitizeThrowable(throwable: Throwable): Throwable {
        return object : Throwable(sanitize(throwable.message ?: ""), throwable.cause) {
            override fun getStackTrace(): Array<StackTraceElement> {
                return throwable.stackTrace
            }
        }
    }

    /**
     * Create sanitized crash report data.
     */
    fun createSanitizedCrashData(
        throwable: Throwable,
        additionalData: Map<String, Any?> = emptyMap()
    ): Map<String, Any?> {
        return mapOf(
            "error_type" to throwable::class.java.simpleName,
            "error_message" to sanitize(throwable.message ?: "Unknown error"),
            "stack_trace" to throwable.stackTrace.take(10).map { it.toString() },
            "additional_data" to sanitizeMap(additionalData)
        )
    }
}

/**
 * BuildConfig placeholder for release checks.
 */
private object BuildConfig {
    val DEBUG = false // Would be set by actual build config
}
