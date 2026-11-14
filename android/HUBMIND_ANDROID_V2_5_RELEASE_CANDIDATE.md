# Hub-Mind Android v2.5.0 — Release Candidate

**Version:** 2.5.0  
**Version code:** 250  
**Application ID:** `com.aistudio.hubmind.wzyqkp`  
**Canonical workspace:** `https://hub-mind.netlify.app/workspace`

## Included capabilities

- Native Android sign-in using the registered Hub-Mind Firebase Android app.
- A native Workspace tab opening the existing Hub-Mind workspace, with a one-time in-memory Google sign-in handoff restricted to the Hub-Mind HTTPS origin.
- Jess Live Voice using the authenticated Gemini Live ephemeral-token flow, with shared account identity, memories, and conversation lease.
- On-phone actions through Android Accessibility / system APIs, subject to the owner enabling Accessibility and granting the requested permissions.
- Paired Windows actions through the shared device registry and command relay, subject to device pairing and active Windows Full Control consent.
- Release identity shown by semantic version and explicit official/test channel labels.

## Release gates

1. Android JVM unit tests and debug APK build must pass.
2. Release APK must build with the existing production signing key; never substitute a debug keystore.
3. Verify package ID, version code/name, signing-certificate continuity, and APK SHA-256.
4. Verify the native app can sign in and open the same workspace account.
5. Verify local phone voice/actions with Accessibility enabled and MediaProjection consent.
6. Verify a paired Windows command completes with an actual execution acknowledgement while Full Control is active.
7. Only after the signed APK and checksum are published may `public/api/app-version.json` advance from the currently verified v2.4.0 release.

Unit tests and source inspection do not replace physical-phone acceptance. The release is not to be represented as fully verified until the device checks above are completed.
