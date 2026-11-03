# Hub-Mind Android Private Website Release

## 1. Distribution and app identity

- **Distribution**: Direct APK download from the Hub-Mind website (not Google Play).
- **Website**: https://hub-mind.netlify.app
- **Application ID**: `com.aistudio.hubmind.wzyqkp` (must remain unchanged).
- **Current integration version**: `2.4.0` / version code `240`.
- **In-app update manifest**: https://hub-mind.netlify.app/api/app-version.json.

The website's Updates panel reads Android APK assets from the public GitHub Releases API. The Android app's update checker reads the static manifest above and verifies the APK SHA-256 before offering installation.

## 2. Create the permanent production signing keystore

Create the keystore on a trusted computer. Do not create it in the repository, upload it to GitHub as a file, or send it in chat.

On Windows PowerShell:

```powershell
$keystoreDir = Join-Path $env:USERPROFILE "Documents\HubMind-Signing"
New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null
$keystorePath = Join-Path $keystoreDir "hubmind-release.jks"

keytool -genkeypair -v `
  -keystore $keystorePath `
  -storetype JKS `
  -alias hubmind-release `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

Keytool prompts for the keystore password, certificate details, and key password. Use strong, unique passwords and store them in a password manager. Do not put passwords directly in the command line.

**Back up the original `.jks` file and both passwords in at least two secure locations.** The private signing key must be retained for the lifetime of the Android app. Future APKs must use this exact keystore and alias or Android will reject them as updates.

The Android project already ignores `*.jks`, `*.keystore`, and `keystore.properties` under `android/`. Never remove those ignore rules.

## 3. Add GitHub Actions repository secrets

Open the repository:

https://github.com/jaystarbliss-dynamic-hub/HUB-MIND/settings/secrets/actions

Create these four **repository secrets**:

| Secret name | Value |
|---|---|
| `ANDROID_RELEASE_KEYSTORE_BASE64` | Base64 encoding of the complete `hubmind-release.jks` file |
| `HUBMIND_RELEASE_STORE_PASSWORD` | Keystore password |
| `HUBMIND_RELEASE_KEY_ALIAS` | `hubmind-release` |
| `HUBMIND_RELEASE_KEY_PASSWORD` | Key password |

To copy the keystore's Base64 value to the Windows clipboard without printing it in chat:

```powershell
$keystorePath = Join-Path $env:USERPROFILE "Documents\HubMind-Signing\hubmind-release.jks"
[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystorePath)) | Set-Clipboard
```

Paste the clipboard value directly into the GitHub secret form for `ANDROID_RELEASE_KEYSTORE_BASE64`. Do not paste it into a terminal transcript, source file, issue, or chat.

If repository Actions settings restrict the workflow token to read-only permissions, an administrator must set **Settings → Actions → General → Workflow permissions → Read and write permissions**. The publishing job separately requests only the `contents: write` permission it needs.

## 4. Run the signed release

After the four secrets are saved:

1. Open https://github.com/jaystarbliss-dynamic-hub/HUB-MIND/actions/workflows/android-apk.yml.
2. Choose **Run workflow** on the `main` branch.
3. Leave **Publish a production-signed Android release** enabled.
4. Start the workflow.

The workflow will:
- build and unit-test the Android app;
- assemble the release APK using the dedicated production keystore;
- verify the package ID, version code/name, APK signature, and certificate fingerprint;
- publish the signed APK as the stable GitHub Release asset `Hub-Mind-Android-v2.4.0.apk` under tag `android-v2.4.0`;
- calculate the APK SHA-256;
- update `public/api/app-version.json` to `PUBLISHED` with the exact release URL and checksum.

When a signed keystore is configured, the debug APK is not published as the production download. Without the signing secrets, CI continues to publish only a clearly labelled debug test prerelease and leaves the app update manifest unpublished.

## 5. Website and update verification

After the release workflow completes, verify all of the following:

- The GitHub release is not marked as a prerelease and contains the signed APK asset.
- The Hub-Mind website Updates → Android tab lists the stable release, marks it **LATEST**, and exposes a direct download link.
- https://hub-mind.netlify.app/api/app-version.json reports `releaseStatus: "PUBLISHED"`, the matching version/application ID, the direct APK URL, and a 64-character SHA-256 checksum.
- The Android update checker accepts only a higher version code for the matching application and verifies the downloaded APK checksum before installation.

The static manifest update is committed by the GitHub Actions publishing job. Netlify must complete the resulting production deploy before the new manifest is served by the live website.

## 6. Important first-install / signing transition

Existing Hub-Mind debug APKs are signed with the Android debug certificate. The new production release uses a different certificate. Android will **not** install the production-signed APK over an existing debug-signed installation.

Before replacing an existing debug installation, confirm that important user data is synced to the Hub-Mind backend or otherwise backed up. The debug app may need to be uninstalled before the official APK is installed. Once the official production-signed build is installed, future updates must keep using the same production keystore.

## 7. Future version releases

For every subsequent Android release:
- increment `versionCode` (it must always increase);
- update `versionName`;
- keep the `applicationId` unchanged;
- retain the original release keystore and alias;
- use the same Actions secrets;
- publish the new version through the Android APK workflow.

Never generate a replacement signing key for an already released app unless you intentionally want to create a different Android application identity or have a supported signing-key upgrade path.
