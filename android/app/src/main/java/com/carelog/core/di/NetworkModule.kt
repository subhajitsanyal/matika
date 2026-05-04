package com.carelog.core.di

import com.carelog.core.config.AppSettings
import com.carelog.network.AuthInterceptor
import com.carelog.network.CloudApiService
import com.carelog.network.MacMiniApiService
import com.carelog.network.MatikaCloudApi
import com.carelog.network.MacMiniLlmApi
import com.carelog.network.MacMiniSttApi
import com.carelog.network.MacMiniTtsApi
import com.carelog.network.MacMiniVisionApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.CertificatePinner
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton

/**
 * Qualifier for the AWS Cloud API Retrofit instance.
 * Uses HTTPS with Cognito JWT auth and certificate pinning.
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class CloudApi

/**
 * Qualifier for the Mac Mini LAN API Retrofit instance.
 * Uses plain HTTP over local network, discovered via mDNS.
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class MacMiniApi

/**
 * Hilt module providing dual Retrofit instances for cloud and LAN communication.
 *
 * - @CloudApi: HTTPS to AWS API Gateway with Cognito JWT, cert pinning, longer timeouts.
 * - @MacMiniApi: HTTP to Mac Mini base URL (from mDNS), no auth, shorter timeouts.
 */
@Module
@InstallIn(SingletonComponent::class)
object DualNetworkModule {

    private const val CLOUD_CONNECT_TIMEOUT_SECONDS = 10L
    private const val CLOUD_READ_TIMEOUT_SECONDS = 30L
    private const val CLOUD_WRITE_TIMEOUT_SECONDS = 30L

    private const val MAC_MINI_CONNECT_TIMEOUT_SECONDS = 5L
    private const val MAC_MINI_READ_TIMEOUT_SECONDS = 10L
    private const val MAC_MINI_WRITE_TIMEOUT_SECONDS = 10L

    // Certificate pinning domain — re-enable when production domain is configured
    private const val API_DOMAIN = "api.carelog.health"
    private const val PIN_PRIMARY = "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    private const val PIN_BACKUP = "sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="

    // Fallback base URL for Mac Mini before mDNS discovery completes
    private const val MAC_MINI_FALLBACK_URL = "http://localhost:8000/"

    @Provides
    @Singleton
    @CloudApi
    fun provideCloudOkHttpClient(
        authInterceptor: AuthInterceptor
    ): OkHttpClient {
        // TODO: Re-enable certificate pinning for production
        // val certificatePinner = CertificatePinner.Builder()
        //     .add(API_DOMAIN, PIN_PRIMARY)
        //     .add(API_DOMAIN, PIN_BACKUP)
        //     .add("*.$API_DOMAIN", PIN_PRIMARY)
        //     .add("*.$API_DOMAIN", PIN_BACKUP)
        //     .build()

        val builder = OkHttpClient.Builder()
            // .certificatePinner(certificatePinner)
            .connectTimeout(CLOUD_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(CLOUD_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(CLOUD_WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .addInterceptor(authInterceptor)

        if (com.carelog.BuildConfig.DEBUG) {
            val loggingInterceptor = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.HEADERS
            }
            builder.addInterceptor(loggingInterceptor)
        }

        return builder.build()
    }

    @Provides
    @Singleton
    @MacMiniApi
    fun provideMacMiniOkHttpClient(
        macMiniUrlProvider: MacMiniUrlProvider
    ): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(MAC_MINI_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(MAC_MINI_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(MAC_MINI_WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            // Rewrite base URL to the dynamically discovered Mac Mini URL.
            // Route to correct port based on the API path:
            //   /health -> 8000, /transcribe -> 8001, /sessions -> 8002,
            //   /synthesize -> 8003, /vision -> 8004
            .addInterceptor { chain ->
                val currentUrl = macMiniUrlProvider.currentUrl
                if (currentUrl != null) {
                    val original = chain.request()
                    val targetUrl = currentUrl.toHttpUrlOrNull() ?: return@addInterceptor chain.proceed(original)
                    val path = original.url.encodedPath
                    val port = when {
                        path.startsWith("/transcribe") || path.startsWith("/stt") -> 8001
                        path.startsWith("/sessions") -> 8002
                        path.startsWith("/synthesize") || path.startsWith("/tts") -> 8003
                        path.startsWith("/vision") || path.startsWith("/extract") -> 8004
                        else -> targetUrl.port
                    }
                    val newUrl = original.url.newBuilder()
                        .scheme(targetUrl.scheme)
                        .host(targetUrl.host)
                        .port(port)
                        .build()
                    chain.proceed(original.newBuilder().url(newUrl).build())
                } else {
                    chain.proceed(chain.request())
                }
            }

        if (com.carelog.BuildConfig.DEBUG) {
            val loggingInterceptor = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.HEADERS
            }
            builder.addInterceptor(loggingInterceptor)
        }

        return builder.build()
    }

    @Provides
    @Singleton
    @CloudApi
    fun provideCloudRetrofit(
        @CloudApi okHttpClient: OkHttpClient
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl(com.carelog.core.BuildConfig.API_BASE_URL + "/")
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideCloudApiService(
        @CloudApi retrofit: Retrofit
    ): CloudApiService {
        return retrofit.create(CloudApiService::class.java)
    }

    /**
     * Matika v2 Bedrock surface (`/conversation/turn`, `/health`,
     * `/conversation/photo-presign`, `/conversation/photo-extract`).
     * Shares the v1 cloud Retrofit instance — same base URL, same
     * Cognito auth interceptor.
     */
    @Provides
    @Singleton
    fun provideMatikaCloudApi(
        @CloudApi retrofit: Retrofit
    ): MatikaCloudApi {
        return retrofit.create(MatikaCloudApi::class.java)
    }

    @Provides
    @Singleton
    @MacMiniApi
    fun provideMacMiniRetrofit(
        @MacMiniApi okHttpClient: OkHttpClient
    ): Retrofit {
        // This Retrofit instance uses a fallback URL. The actual Mac Mini URL
        // is dynamic (discovered via mDNS). HealthCheckService and other callers
        // create per-request Retrofit instances using the discovered URL.
        return Retrofit.Builder()
            .baseUrl(MAC_MINI_FALLBACK_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideMacMiniApiService(
        @MacMiniApi retrofit: Retrofit
    ): MacMiniApiService {
        return retrofit.create(MacMiniApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideMacMiniSttApi(
        @MacMiniApi retrofit: Retrofit
    ): MacMiniSttApi {
        return retrofit.create(MacMiniSttApi::class.java)
    }

    @Provides
    @Singleton
    fun provideMacMiniLlmApi(
        @MacMiniApi retrofit: Retrofit
    ): MacMiniLlmApi {
        return retrofit.create(MacMiniLlmApi::class.java)
    }

    @Provides
    @Singleton
    fun provideMacMiniTtsApi(
        @MacMiniApi retrofit: Retrofit
    ): MacMiniTtsApi {
        return retrofit.create(MacMiniTtsApi::class.java)
    }

    @Provides
    @Singleton
    fun provideMacMiniVisionApi(
        @MacMiniApi retrofit: Retrofit
    ): MacMiniVisionApi {
        return retrofit.create(MacMiniVisionApi::class.java)
    }
}
