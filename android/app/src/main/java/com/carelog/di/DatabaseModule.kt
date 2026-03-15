package com.carelog.di

import android.content.Context
import com.carelog.fhir.local.dao.DocumentReferenceDao
import com.carelog.fhir.local.dao.ObservationDao
import com.carelog.fhir.local.database.FhirDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for database dependencies.
 */
@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideFhirDatabase(
        @ApplicationContext context: Context
    ): FhirDatabase {
        return FhirDatabase.getInstance(context)
    }

    @Provides
    @Singleton
    fun provideObservationDao(database: FhirDatabase): ObservationDao {
        return database.observationDao()
    }

    @Provides
    @Singleton
    fun provideDocumentReferenceDao(database: FhirDatabase): DocumentReferenceDao {
        return database.documentReferenceDao()
    }
}
