package com.carelog.network

import okhttp3.CertificatePinner
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Certificate pinning configuration for API Gateway.
 * Prevents MITM attacks by validating server certificates.
 */
@Singleton
class CertificatePinning @Inject constructor() {

    companion object {
        // API Gateway domain
        private const val API_DOMAIN = "api.carelog.health"

        // SHA-256 certificate pins
        // Primary certificate pin
        private const val PIN_PRIMARY = "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        // Backup certificate pin (for rotation)
        private const val PIN_BACKUP = "sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="

        // Connection timeouts
        private const val CONNECT_TIMEOUT_SECONDS = 30L
        private const val READ_TIMEOUT_SECONDS = 30L
        private const val WRITE_TIMEOUT_SECONDS = 30L
    }

    /**
     * Create OkHttpClient with certificate pinning.
     *
     * NOTE: Certificate pinning is temporarily disabled because we are using
     * the API Gateway domain (not api.carelog.health) during development.
     * Re-enable pinning when the production domain is configured.
     */
    fun createPinnedClient(): OkHttpClient {
        // TODO: Re-enable certificate pinning for production
        // val certificatePinner = CertificatePinner.Builder()
        //     .add(API_DOMAIN, PIN_PRIMARY)
        //     .add(API_DOMAIN, PIN_BACKUP)
        //     // Also pin wildcard subdomains
        //     .add("*.$API_DOMAIN", PIN_PRIMARY)
        //     .add("*.$API_DOMAIN", PIN_BACKUP)
        //     .build()

        return OkHttpClient.Builder()
            // .certificatePinner(certificatePinner)
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .addInterceptor(SecurityHeadersInterceptor())
            .build()
    }

    /**
     * Interceptor to add security headers to requests.
     */
    private class SecurityHeadersInterceptor : okhttp3.Interceptor {
        override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
            val request = chain.request().newBuilder()
                .addHeader("X-Content-Type-Options", "nosniff")
                .addHeader("X-Frame-Options", "DENY")
                .build()
            return chain.proceed(request)
        }
    }
}

/**
 * Hilt module for providing pinned OkHttpClient.
 */
@dagger.Module
@dagger.hilt.InstallIn(dagger.hilt.components.SingletonComponent::class)
object NetworkModule {

    @dagger.Provides
    @javax.inject.Singleton
    fun provideOkHttpClient(certificatePinning: CertificatePinning): OkHttpClient {
        return certificatePinning.createPinnedClient()
    }
}
