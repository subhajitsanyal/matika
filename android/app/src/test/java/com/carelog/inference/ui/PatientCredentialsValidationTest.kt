package com.carelog.inference.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * F39 — validators behind the F23 voice-onboarding contact-details
 * form. Pure JVM tests; live UX coverage comes from the on-device
 * verification documented in the F39 entry of testing_todos_v2.md.
 */
class PatientCredentialsValidationTest {

    @Test
    fun `empty email is Empty`() {
        assertTrue(validateEmail("") is EmailValidation.Empty)
        assertTrue(validateEmail("   ") is EmailValidation.Empty)
    }

    @Test
    fun `obviously wrong email is BadFormat`() {
        assertTrue(validateEmail("foo") is EmailValidation.BadFormat)
        assertTrue(validateEmail("foo@") is EmailValidation.BadFormat)
        assertTrue(validateEmail("foo@bar") is EmailValidation.BadFormat)
        assertTrue(validateEmail("@bar.com") is EmailValidation.BadFormat)
        assertTrue(validateEmail("foo bar@baz.com") is EmailValidation.BadFormat)
    }

    @Test
    fun `valid email passes and trims whitespace`() {
        val ok = validateEmail("  sanyalsubhajit2010+at@gmail.com  ")
        assertTrue(ok is EmailValidation.Ok)
        assertEquals("sanyalsubhajit2010+at@gmail.com", (ok as EmailValidation.Ok).cleaned)
    }

    @Test
    fun `empty phone is Empty`() {
        assertTrue(validatePhone("") is PhoneValidation.Empty)
        assertTrue(validatePhone("   ") is PhoneValidation.Empty)
        assertTrue(validatePhone("  - - ") is PhoneValidation.Empty)
    }

    @Test
    fun `non-E164 phone is BadFormat`() {
        // No leading +
        assertTrue(validatePhone("9876543210") is PhoneValidation.BadFormat)
        // Too short
        assertTrue(validatePhone("+12") is PhoneValidation.BadFormat)
        // Non-digit after +
        assertTrue(validatePhone("+91abc4567890") is PhoneValidation.BadFormat)
        // Too long
        assertTrue(validatePhone("+1234567890123456") is PhoneValidation.BadFormat)
    }

    @Test
    fun `valid phone passes and strips caregiver-friendly separators`() {
        val ok = validatePhone("+91 98765 43210")
        assertTrue(ok is PhoneValidation.Ok)
        assertEquals("+919876543210", (ok as PhoneValidation.Ok).cleaned)
    }

    @Test
    fun `valid phone with dashes and parens normalizes`() {
        val ok = validatePhone(" +1 (415) 555-1234 ")
        assertTrue(ok is PhoneValidation.Ok)
        assertEquals("+14155551234", (ok as PhoneValidation.Ok).cleaned)
    }
}
