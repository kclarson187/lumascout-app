# LumaScout — Universal Links / App Links hosting files

These are the production-ready `.well-known` files that unlock native deep-linking so shared URLs like `https://lumascout.app/spot/abc123` open the installed LumaScout app directly instead of falling through to a 404 / web view.

> **Scope:** files only. The Expo side is already wired in this repo (`app.json` — `ios.associatedDomains`, `android.intentFilters`, and `expo-router` `origin`). These two files must be **hosted on the canonical web domain** (the separate Next.js web project) for the OS to actually activate the links.

## Files

| File | Hosted path | Notes |
|---|---|---|
| `apple-app-site-association` | `https://lumascout.app/.well-known/apple-app-site-association` | **No extension.** `Content-Type: application/json`. HTTPS only, no redirects. |
| `assetlinks.json` | `https://lumascout.app/.well-known/assetlinks.json` | `Content-Type: application/json`. HTTPS only, no redirects. |

## Placeholders you must replace before production submission

Edit the staged files (or set them during your web deploy build step):

| Placeholder | Where | How to get it |
|---|---|---|
| `APPLE_TEAM_ID_HERE` | `apple-app-site-association` (2 places — `appID` + `webcredentials.apps[0]`) | Apple Developer Portal → Membership → **Team ID** (10-char alphanumeric, e.g. `ABCD123456`). |
| `ANDROID_SHA256_CERT_FINGERPRINT_HERE` | `assetlinks.json` → `sha256_cert_fingerprints[0]` | Google Play Console → your app → **Release → Setup → App integrity** → **App signing key certificate** → SHA-256. (Or `keytool -list -v -keystore <your.keystore>` for upload keys.) |

> Bundle ID (`com.lumascout.app`) and Android package name (`com.lumascout.app`) are already hard-coded — they match `app.json` and will not change.

## Hosting in the (separate) Next.js web project

Because the web app lives in its own Emergent project, drop both files into the public static root:

```
web/
  public/
    .well-known/
      apple-app-site-association     # no extension
      assetlinks.json
```

Next.js serves everything under `public/` at the site root by default. You may need to explicitly set the response `Content-Type` for `apple-app-site-association` because it has no file extension — do this in `next.config.js` headers or the hosting provider's config:

```js
// next.config.js — example
module.exports = {
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },
};
```

## Verification checklist (after hosting + signed EAS/TestFlight build)

- [ ] `curl -I https://lumascout.app/.well-known/apple-app-site-association` → `200`, `Content-Type: application/json`, **no redirects**.
- [ ] `curl -I https://lumascout.app/.well-known/assetlinks.json` → `200`, `Content-Type: application/json`.
- [ ] Paste a `https://lumascout.app/spot/<id>` link into iMessage on a physical iPhone that has the TestFlight build installed — tap → **opens the native app on Spot Detail**, not Safari.
- [ ] On a physical Android device with the signed APK/AAB: `adb shell pm get-app-links com.lumascout.app` → `Domain verification state: verified`.
- [ ] Apple's validator: https://branch.io/resources/aasa-validator/ (paste `lumascout.app`).

## Known limitations

- **Expo Go does NOT support Universal Links / App Links.** Full deep-link behavior activates only in a signed EAS **development build**, TestFlight, or Play Internal Testing build. In Expo Go, tapping an `https://lumascout.app/spot/<id>` link falls back to the browser — this is expected and not a bug.
- iOS aggressively caches AASA — after editing Team ID you may need to uninstall/reinstall to re-fetch.
- Android auto-verification requires the SHA-256 to match the **installed** APK's signing cert. For debug-signed builds, use the debug fingerprint; for Play-signed builds, use Play's App signing key fingerprint.

## Where the mobile side of this is wired (already done in this repo)

- `/app/frontend/app.json`
  - `expo.ios.associatedDomains`: `['applinks:lumascout.app']`
  - `expo.android.intentFilters`: `https://lumascout.app` with `autoVerify: true` (covers `/spot`, `/user`, `/collection`, `/community`, `/marketplace`)
  - `expo.plugins` → `['expo-router', { origin: 'https://lumascout.app' }]` — tells Expo Router that `https://lumascout.app/*` URLs should map to file-based routes (so `https://lumascout.app/spot/123` → `app/spot/[id].tsx` opens natively).
- `/app/frontend/.env`
  - `EXPO_PUBLIC_WEB_BASE_URL=https://lumascout.app` — canonical origin for every `Share.share()` URL in the app (Explore pin preview + Spot Detail share button).
