# Sophira Device Acceptance Matrix

Honest record of physical-device testing. NOTHING is marked PASS unless the
test actually ran on that physical device on that date. Items that have not
been run are marked **NOT TESTED** with the reason.

Last updated: 2026-10-06

| Platform | Device | OS / Version | App type | Test date | Result |
| --- | --- | --- | --- | --- | --- |
| iPhone | NOT TESTED — no physical device available to the agent | — | PWA | — | NOT TESTED |
| iPhone | NOT TESTED — requires signed .ipa (Apple Developer cert + provisioning; see docs/NATIVE_BUILDS.md) | — | IPA | — | NOT TESTED |
| iPad | NOT TESTED — no physical device available | — | PWA/native | — | NOT TESTED |
| Android | NOT TESTED — no physical device available | — | PWA | — | NOT TESTED |
| Android | NOT TESTED — requires release APK + real deployment URL (SOPHIRA_APP_URL) | — | APK | — | NOT TESTED |
| Windows | NOT TESTED — no Windows machine available | — | desktop (.msi) | — | NOT TESTED |
| macOS | NOT TESTED — no Mac available | — | desktop (.dmg) | — | NOT TESTED |
| Linux | NOT TESTED — native desktop build requires Rust+webkit2gtk toolchain not present in the agent sandbox; CI matrix builds it once workflows are activated | — | desktop (.AppImage/.deb) | — | NOT TESTED |
| Desktop (Chromium, cloud) | Browserbase desktop browser, 1280px viewport | real desktop browser | web app | 2026-10-06 | VERIFIED — loads, /login renders sign-in form, /install renders correct device instructions (browser verification, not a native-OS test) |

## What HAS been verified without physical devices

- The Android Gradle project genuinely builds and produces a valid APK in the
  agent sandbox (see TEST_REPORT §20 for the exact result, signature status
  and checksum). This is a **build verification**, not a device test.
- A RELEASE APK (assembleRelease, production URL embedded, target SDK 35)
  is also built and verified — `android/app/build/outputs/apk/release/
  app-release-unsigned.apk`. It is UNSIGNED by the honest fallback (no signing
  secrets in this environment) and therefore NOT installable until CI signs
  it with the owner keystore; the DEBUG APK (same code, same production URL,
  debug-signed, `app-debug.apk`) IS installable for device testing. See
  TEST_REPORT §50. Build verification, not a device test.
- Desktop browser verification (2026-10-06): the production web app loads
  and renders in a real Chromium desktop browser — sign-in form, invitation
  link, /install instructions, PWA manifest (standalone, icons 192/512,
  start_url /dashboard) and service worker all serve correctly. See
  TEST_REPORT §50. Browser verification, not a device test.
- All web/PWA behavior is covered by the automated test suite (144 assertions)
  and the responsive 360/390/430px + landscape requirements are enforced in
  the layout.
- Live-backend and real-AI acceptance rows remain open in
  docs/MASTER_ACCEPTANCE_WORKFLOW.md until run against the deployed
  environment with real credentials.

## How to run a row for real

1. Install the artifact on the target device (PWA via /install, APK via
   direct download, IPA via ad-hoc registration or TestFlight, desktop via
   the installer).
2. Walk docs/MASTER_ACCEPTANCE_WORKFLOW.md steps 1-27 on the device.
3. Record device model, OS version, app version, date and result above.
