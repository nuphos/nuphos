plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val releaseVersionCode = providers.gradleProperty("nuphosVersionCode").orElse("1").get()
val releaseVersionName = providers.gradleProperty("nuphosVersionName").orElse("1.0").get()
require(releaseVersionCode.matches(Regex("[1-9][0-9]{0,9}")) &&
    (releaseVersionCode.toLongOrNull() ?: Long.MAX_VALUE) <= 2100000000L) {
    "nuphosVersionCode must be an integer from 1 to 2100000000 without leading zeros"
}
require(releaseVersionName.matches(Regex("[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}"))) {
    "nuphosVersionName must contain 1-64 filename-safe characters"
}

android {
    namespace = "ai.nuphos.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "ai.nuphos.android"
        minSdk = 33
        targetSdk = 36
        versionCode = releaseVersionCode.toInt()
        versionName = releaseVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        jvmToolchain(17)
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    sourceSets {
        getByName("test").kotlin.srcDir("src/testSupport/java")
        getByName("androidTest").kotlin.srcDir("src/testSupport/java")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material3.adaptive.navigation.suite)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.security.crypto)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.datetime)
    implementation(libs.markdown.renderer)
    implementation(libs.markdown.renderer.m3)
    implementation(libs.markdown.renderer.coil3)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
