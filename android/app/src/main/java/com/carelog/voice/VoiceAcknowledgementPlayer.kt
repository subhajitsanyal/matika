package com.carelog.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import com.carelog.fhir.client.ObservationType
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Plays voice acknowledgement audio clips for vital logging events.
 *
 * Audio plays through media stream to work even in silent mode.
 * Clips should be bundled in res/raw directory.
 */
@Singleton
class VoiceAcknowledgementPlayer @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private var mediaPlayer: MediaPlayer? = null

    /**
     * Play success acknowledgement for a specific vital type.
     */
    fun playSuccess(type: ObservationType) {
        val resourceId = getSuccessResourceId(type)
        playAudio(resourceId)
    }

    /**
     * Play generic success acknowledgement.
     */
    fun playGenericSuccess() {
        // R.raw.success_generic - "Saved successfully"
        playAudio(getGenericSuccessResourceId())
    }

    /**
     * Play failure acknowledgement.
     */
    fun playFailure() {
        // R.raw.failure - "Could not save, please try again"
        playAudio(getFailureResourceId())
    }

    /**
     * Play no network acknowledgement.
     */
    fun playNoNetwork() {
        // R.raw.no_network - "No internet connection"
        playAudio(getNoNetworkResourceId())
    }

    /**
     * Play upload success acknowledgement.
     */
    fun playUploadSuccess() {
        // R.raw.upload_success - "File uploaded successfully"
        playAudio(getUploadSuccessResourceId())
    }

    private fun playAudio(resourceId: Int) {
        // Release any existing player
        mediaPlayer?.release()

        try {
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )

                // Use AssetFileDescriptor for raw resources
                val afd = context.resources.openRawResourceFd(resourceId)
                if (afd != null) {
                    setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                    afd.close()
                    prepare()
                    start()

                    setOnCompletionListener { mp ->
                        mp.release()
                        mediaPlayer = null
                    }
                }
            }
        } catch (e: Exception) {
            // Audio playback failed - log but don't crash
            mediaPlayer?.release()
            mediaPlayer = null
        }
    }

    private fun getSuccessResourceId(type: ObservationType): Int {
        // Map observation type to audio resource
        // These would be actual R.raw.xxx resource IDs
        return when (type) {
            ObservationType.BLOOD_PRESSURE -> getResourceIdForName("success_blood_pressure")
            ObservationType.BLOOD_GLUCOSE -> getResourceIdForName("success_glucose")
            ObservationType.BODY_TEMPERATURE -> getResourceIdForName("success_temperature")
            ObservationType.BODY_WEIGHT -> getResourceIdForName("success_weight")
            ObservationType.HEART_RATE -> getResourceIdForName("success_pulse")
            ObservationType.OXYGEN_SATURATION -> getResourceIdForName("success_spo2")
            else -> getGenericSuccessResourceId()
        }
    }

    private fun getGenericSuccessResourceId(): Int {
        return getResourceIdForName("success_generic")
    }

    private fun getFailureResourceId(): Int {
        return getResourceIdForName("failure")
    }

    private fun getNoNetworkResourceId(): Int {
        return getResourceIdForName("no_network")
    }

    private fun getUploadSuccessResourceId(): Int {
        return getResourceIdForName("upload_success")
    }

    private fun getResourceIdForName(name: String): Int {
        // Get resource ID by name, falling back to a default
        val resourceId = context.resources.getIdentifier(name, "raw", context.packageName)
        return if (resourceId != 0) resourceId else getFallbackResourceId()
    }

    private fun getFallbackResourceId(): Int {
        // Return a fallback resource ID or 0 if none exists
        return context.resources.getIdentifier("success_generic", "raw", context.packageName)
    }

    fun release() {
        mediaPlayer?.release()
        mediaPlayer = null
    }
}
