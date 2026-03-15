package com.carelog.di

import com.carelog.auth.AuthRepository
import com.carelog.fhir.client.FhirClient
import com.carelog.fhir.client.FhirClientConfig
import com.carelog.fhir.client.HealthLakeFhirClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for FHIR client dependencies.
 */
@Module
@InstallIn(SingletonComponent::class)
object FhirModule {

    @Provides
    @Singleton
    fun provideFhirClientConfig(): FhirClientConfig {
        // TODO: Get these from BuildConfig or environment
        return FhirClientConfig(
            baseUrl = "https://api.carelog.app/fhir",
            healthLakeDatastoreId = "placeholder-datastore-id"
        )
    }

    @Provides
    @Singleton
    fun provideFhirClient(
        authRepository: AuthRepository,
        config: FhirClientConfig
    ): FhirClient {
        return HealthLakeFhirClient(authRepository, config)
    }
}
