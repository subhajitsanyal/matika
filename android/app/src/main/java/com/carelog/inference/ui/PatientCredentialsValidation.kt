package com.carelog.inference.ui

/**
 * F39 — validators for the F23 voice-onboarding contact-details form.
 *
 * Kept as pure top-level functions (no Android-stdlib deps like
 * `android.util.Patterns`) so the existing JVM JUnit test suite can
 * exercise them directly without Robolectric or instrumentation.
 *
 * Email rule is intentionally permissive — "catch typos that obviously
 * aren't email" rather than full RFC 5322. Phone is strict E.164 after
 * stripping caregiver-friendly separators (spaces, dashes,
 * parentheses).
 */

private val EMAIL_REGEX = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$")
private val PHONE_E164_REGEX = Regex("^\\+\\d{8,15}$")
private val PHONE_STRIP_REGEX = Regex("[\\s\\-()]")

internal fun normalizePhone(raw: String): String =
    raw.trim().replace(PHONE_STRIP_REGEX, "")

internal fun validateEmail(raw: String): EmailValidation {
    val trimmed = raw.trim()
    return when {
        trimmed.isBlank() -> EmailValidation.Empty
        !EMAIL_REGEX.matches(trimmed) -> EmailValidation.BadFormat
        else -> EmailValidation.Ok(trimmed)
    }
}

internal fun validatePhone(raw: String): PhoneValidation {
    val cleaned = normalizePhone(raw)
    return when {
        cleaned.isBlank() -> PhoneValidation.Empty
        !PHONE_E164_REGEX.matches(cleaned) -> PhoneValidation.BadFormat
        else -> PhoneValidation.Ok(cleaned)
    }
}

internal sealed class EmailValidation {
    object Empty : EmailValidation()
    object BadFormat : EmailValidation()
    data class Ok(val cleaned: String) : EmailValidation()
}

internal sealed class PhoneValidation {
    object Empty : PhoneValidation()
    object BadFormat : PhoneValidation()
    data class Ok(val cleaned: String) : PhoneValidation()
}
