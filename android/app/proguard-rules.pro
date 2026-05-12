# CareLog ProGuard Rules
# HIPAA Compliance: Ensure no PHI is logged in release builds

# Keep FHIR model classes
-keep class org.hl7.fhir.** { *; }
-keep class ca.uhn.fhir.** { *; }

# Keep AWS Amplify classes
-keep class com.amplifyframework.** { *; }
-keep class com.amazonaws.** { *; }

# Keep Kotlin serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep CareLog data classes
-keep class com.carelog.fhir.** { *; }
-keep class com.carelog.core.** { *; }

# Retrofit
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Room
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# Hilt
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }

# WorkManager
-keep class * extends androidx.work.Worker
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context,androidx.work.WorkerParameters);
}

# Remove logging in release builds - HIPAA compliance
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}

# HAPI FHIR + transitive deps reference optional libraries (Thymeleaf
# for narrative rendering, Schematron validation, Java AWT, JAXB
# crypto, Apache POI, Saxon, etc.) that aren't on Android. Code paths
# that need them are never invoked on the client. R8 generates a
# corresponding missing_rules.txt at build/outputs/mapping/release/
# every release build; bumping HAPI may add new packages here.
-dontwarn ca.uhn.fhir.rest.server.**
-dontwarn org.hl7.fhir.r4.hapi.ctx.FhirServerR4
-dontwarn com.ctc.wstx.**
-dontwarn com.github.rjeschke.**
-dontwarn com.helger.**
-dontwarn java.awt.**
-dontwarn javax.imageio.**
-dontwarn javax.naming.**
-dontwarn javax.xml.crypto.**
-dontwarn javax.xml.stream.**
-dontwarn javax.xml.transform.stax.**
-dontwarn javax.xml.bind.**
-dontwarn org.apache.commons.**
-dontwarn org.apache.jena.**
-dontwarn org.apache.poi.**
-dontwarn org.codehaus.stax2.**
-dontwarn org.commonmark.**
-dontwarn org.fhir.ucum.**
-dontwarn org.ietf.jgss.**
-dontwarn org.junit.**
-dontwarn org.openxmlformats.**
-dontwarn org.stringtemplate.**
-dontwarn org.thymeleaf.**
-dontwarn net.sf.saxon.**
-dontwarn org.w3c.dom.events.**
-dontwarn kotlinx.parcelize.**
