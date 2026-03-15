package com.carelog.fhir.local.entities

/**
 * Sync status for local FHIR resources.
 */
enum class SyncStatus {
    /** Resource created locally, not yet synced to server. */
    PENDING,

    /** Resource successfully synced to server. */
    SYNCED,

    /** Sync failed, will retry on next sync cycle. */
    FAILED,

    /** Resource modified locally after sync, needs re-sync. */
    MODIFIED
}
