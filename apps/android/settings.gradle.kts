pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "nuphos-android"
include(":app")

// Synthetic cross-UID sender is never part of a production build.
if (providers.gradleProperty("nuphosIsolatedShareFixture").orNull == "true" || providers.gradleProperty("nuphosIsolatedPersistentShareFixture").orNull == "true") include(":share-sender")
