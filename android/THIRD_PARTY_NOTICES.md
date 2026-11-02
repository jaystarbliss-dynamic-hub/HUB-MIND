# Third-Party Notices — Hub-Mind Android

This Android application incorporates open-source libraries and adapted architectural components under the following licenses:

## 1. Google ARTEMIS (Adapted UI Observation, Element Filtering & Hit-Testing)
- **Source**: https://github.com/google/artemis (`artemis/utils/ui_filter.py`, `artemis/utils/element_hit_test.py`, `packages/artemis-accessibility-helper`)
- **Copyright**: Copyright 2026 Google LLC
- **License**: Apache License, Version 2.0 (`https://www.apache.org/licenses/LICENSE-2.0`)
- **Integration**: Adapted into native Kotlin in `com.example.hubmind.agent.ArtemisUiObservationEngine` and `com.example.hubmind.agent.HubMindAccessibilityService` for on-device UI bounds clipping, minimum-size filtering, indexed element extraction, and smallest-covering-area coordinate hit-testing.

## 2. Android Jetpack & Compose (Google)
- **Packages**: `androidx.core:core-ktx`, `androidx.activity:activity-compose`, `androidx.compose.*`, `androidx.lifecycle.*`, `androidx.navigation:navigation-compose`
- **License**: Apache License, Version 2.0

## 3. Firebase Android SDK & Google Play Services Auth (Google)
- **Packages**: `com.google.firebase:firebase-bom`, `firebase-auth`, `firebase-firestore`, `com.google.android.gms:play-services-auth`
- **License**: Apache License, Version 2.0 / Google APIs Terms of Service

## 4. Square OkHttp
- **Package**: `com.squareup.okhttp3:okhttp:4.12.0`
- **License**: Apache License, Version 2.0

## 5. Kotlin Coroutines (JetBrains)
- **Packages**: `org.jetbrains.kotlinx:kotlinx-coroutines-core`, `kotlinx-coroutines-android`, `kotlinx-coroutines-play-services`
- **License**: Apache License, Version 2.0
