package com.carelog.di

import com.carelog.ui.consent.ConsentRepository
import com.carelog.ui.consent.ConsentRepositoryImpl
import com.carelog.ui.invite.InviteRepository
import com.carelog.ui.invite.InviteRepositoryImpl
import com.carelog.ui.onboarding.PatientRepository
import com.carelog.ui.onboarding.PatientRepositoryImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for repository dependencies.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindConsentRepository(
        consentRepositoryImpl: ConsentRepositoryImpl
    ): ConsentRepository

    @Binds
    @Singleton
    abstract fun bindInviteRepository(
        inviteRepositoryImpl: InviteRepositoryImpl
    ): InviteRepository

    @Binds
    @Singleton
    abstract fun bindPatientRepository(
        patientRepositoryImpl: PatientRepositoryImpl
    ): PatientRepository
}
