// Athan Frame on-device bridge app.
//
// Target: Rockchip RK3566 frames running Android 11 (API 30). We compile
// against API 34 for newer APIs but keep the minSdk low so the same APK
// installs on the device.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.athanframe.bridge"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.athanframe.bridge"
        minSdk = 26                  // 8.0 Oreo (foreground service support)
        targetSdk = 30               // matches the frame's runtime so we behave consistently
        versionCode = 1
        versionName = "0.1.0"
        // App icon name is set in AndroidManifest.xml
    }

    buildTypes {
        release {
            isMinifyEnabled = false  // small app, no obfuscation needed yet
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            // Debug builds are signed with the SDK's debug key, which the
            // userdebug frame is happy to install.
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            kotlin.srcDirs("src/main/kotlin")
            assets.srcDirs("src/main/assets")
        }
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/AL2.0",
                "META-INF/LGPL2.1",
                "META-INF/*.kotlin_module"
            )
        }
    }
}

dependencies {
    // AndroidX core
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")

    // Coroutines for the HTTP server worker
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // JSON (built-in org.json works fine; using kotlinx-serialization for typed APIs)
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // NanoHTTPD: tiny embedded web server, MIT-licensed (~80KB)
    implementation("org.nanohttpd:nanohttpd:2.3.1")

    // QR code generation for the on-screen setup card
    implementation("com.google.zxing:core:3.5.3")
}
