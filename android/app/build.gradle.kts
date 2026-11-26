plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.musictoblutooth"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        targetSdk = 34
        versionCode = 100
        versionName = "1.0.0"

        val serverUrl = (project.findProperty("MTB_SERVER_URL") as String?)
            ?: "https://ais-pre-2jiqjqpwnn2ipdiouf2thr-63285293710.asia-east1.run.app"
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    flavorDimensions += "role"
    productFlavors {
        create("transmitter") {
            dimension = "role"
            applicationId = "com.musictoblutooth.transmitter"
            resValue("string", "app_name", "MusicToBlutooth Truyền")
            buildConfigField("String", "APP_ROLE", "\"host\"")
        }
        create("receiver") {
            dimension = "role"
            applicationId = "com.musictoblutooth.receiver"
            resValue("string", "app_name", "MusicToBlutooth Nhận")
            buildConfigField("String", "APP_ROLE", "\"receiver\"")
        }
    }

    signingConfigs {
        getByName("debug") {
            // Ky so nhanh ban Release APK cai dat truc tiep tren Android
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
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

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Khac phuc triet de loi checkReleaseDuplicateClasses giua kotlin-stdlib va kotlin-stdlib-jdk8
configurations.all {
    resolutionStrategy {
        force("org.jetbrains.kotlin:kotlin-stdlib:1.9.24")
        force("org.jetbrains.kotlin:kotlin-stdlib-common:1.9.24")
        force("org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.24")
        force("org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.24")
    }
}

dependencies {
    implementation(platform("org.jetbrains.kotlin:kotlin-bom:1.9.24"))
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.24")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
