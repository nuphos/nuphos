plugins { alias(libs.plugins.android.application) }
android {
    namespace = "ai.nuphos.sharefixture"
    compileSdk = 37
    defaultConfig {
        val persistent = providers.gradleProperty("nuphosIsolatedPersistentShareFixture").orNull == "true"
        applicationId = if (persistent) "ai.nuphos.sharepersist1359.sender" else "ai.nuphos.shareinput1355.sender"
        manifestPlaceholders["fixtureReceiver"] = if (persistent) "ai.nuphos.android.sharepersist1359" else "ai.nuphos.android.shareinput1355"
        manifestPlaceholders["fixtureAuthority"] = "$applicationId.files"
        minSdk = 33
        targetSdk = 36
        versionCode = 1
        versionName = "synthetic-1"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
