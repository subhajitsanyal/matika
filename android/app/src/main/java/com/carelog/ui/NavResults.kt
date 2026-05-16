package com.carelog.ui

import androidx.navigation.NavController

/**
 * Tiny convention for propagating post-write events from a child screen
 * back to its parent via Jetpack Navigation's `savedStateHandle`.
 *
 * Used by PR-3 of the v2 staging bench-fix wave to wire:
 *  - Caregiver dashboard auto-refresh after Add Patient (form + voice).
 *  - Patient home Snackbar on manual-vital save (BP only for now;
 *    Pulse/SpO2/Sugar/Temperature/Weight follow the same shape and are
 *    a follow-up — see PR-3 commit message).
 *
 * Keys are deliberately small. If a third consumer shows up we can
 * promote the strings/types here; until then the inline reads in
 * CaregiverHomeScreen + PatientHomeScreen are clearest.
 */
object NavResults {
    /** Boolean — set on Add-Patient success path (form OR voice). */
    const val PATIENT_ADDED = "patient_added"

    /** String — the human-readable vital, e.g. "BP 128/82 mmHg". */
    const val VITAL_SAVED = "vital_saved"

    /**
     * Set `patient_added = true` on [route]'s SavedStateHandle if that
     * entry exists in the back stack. No-op when the entry is gone —
     * happens if the user navigated forward away from the dashboard
     * before the child screen finished writing.
     */
    fun setPatientAdded(navController: NavController, route: String) {
        runCatching { navController.getBackStackEntry(route) }
            .getOrNull()
            ?.savedStateHandle
            ?.set(PATIENT_ADDED, true)
    }

    /**
     * Set `vital_saved = <label>` on [route]'s SavedStateHandle.
     * Same semantics as [setPatientAdded].
     */
    fun setVitalSaved(navController: NavController, route: String, label: String) {
        runCatching { navController.getBackStackEntry(route) }
            .getOrNull()
            ?.savedStateHandle
            ?.set(VITAL_SAVED, label)
    }
}
