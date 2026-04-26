package com.carelog.core.config

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Extension property for DataStore on Context. */
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(
    name = "carelog_settings"
)

/**
 * Audio capture mode: batch (record full utterance then send) or streaming (WebSocket).
 */
enum class AudioMode {
    BATCH,
    STREAMING
}

/**
 * Supported languages for STT/TTS/LLM interactions.
 */
enum class AppLanguage(val code: String) {
    ENGLISH("en"),
    HINDI("hi"),
    BENGALI("bn");

    companion object {
        fun fromCode(code: String?): AppLanguage {
            return entries.find { it.code == code } ?: ENGLISH
        }
    }
}

/**
 * DataStore-based application settings.
 *
 * Stores user preferences for audio mode, language, Mac Mini URL,
 * and streaming toggle. All values are exposed as Flows for
 * reactive observation in ViewModels.
 */
@Singleton
class AppSettings @Inject constructor(
    @ApplicationContext private val context: Context
) {

    private val dataStore: DataStore<Preferences>
        get() = context.dataStore

    private object Keys {
        val AUDIO_MODE = stringPreferencesKey("audio_mode")
        val MAC_MINI_BASE_URL = stringPreferencesKey("mac_mini_base_url")
        val LANGUAGE = stringPreferencesKey("language")
        val STREAMING_ENABLED = booleanPreferencesKey("streaming_enabled")
    }

    /**
     * Audio mode: batch (default) or streaming.
     */
    val audioMode: Flow<AudioMode> = dataStore.data.map { prefs ->
        val value = prefs[Keys.AUDIO_MODE]
        try {
            AudioMode.valueOf(value ?: AudioMode.BATCH.name)
        } catch (_: IllegalArgumentException) {
            AudioMode.BATCH
        }
    }

    suspend fun setAudioMode(mode: AudioMode) {
        dataStore.edit { prefs ->
            prefs[Keys.AUDIO_MODE] = mode.name
        }
    }

    /**
     * Mac Mini base URL discovered via mDNS.
     * Null if no Mac Mini has been discovered yet.
     */
    val macMiniBaseUrl: Flow<String?> = dataStore.data.map { prefs ->
        prefs[Keys.MAC_MINI_BASE_URL]
    }

    suspend fun setMacMiniBaseUrl(url: String?) {
        dataStore.edit { prefs ->
            if (url != null) {
                prefs[Keys.MAC_MINI_BASE_URL] = url
            } else {
                prefs.remove(Keys.MAC_MINI_BASE_URL)
            }
        }
    }

    /**
     * Preferred language for STT/TTS/LLM.
     */
    val language: Flow<AppLanguage> = dataStore.data.map { prefs ->
        AppLanguage.fromCode(prefs[Keys.LANGUAGE])
    }

    suspend fun setLanguage(language: AppLanguage) {
        dataStore.edit { prefs ->
            prefs[Keys.LANGUAGE] = language.code
        }
    }

    /**
     * Whether streaming mode is enabled (as opposed to batch).
     * This is the user-facing toggle in settings.
     */
    val streamingEnabled: Flow<Boolean> = dataStore.data.map { prefs ->
        prefs[Keys.STREAMING_ENABLED] ?: false
    }

    suspend fun setStreamingEnabled(enabled: Boolean) {
        dataStore.edit { prefs ->
            prefs[Keys.STREAMING_ENABLED] = enabled
        }
    }
}
