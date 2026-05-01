# LumaScout — App Store submission assets (Batch #7)

This folder holds production-ready files that ship **next to** the mobile app but are **not** part of the JS bundle:

| File | Purpose | Where it's installed |
|---|---|---|
| `PrivacyInfo.xcprivacy` | Apple Privacy Manifest (required for App Store review since Feb 2025) | Into the iOS native target during EAS build |
| `ASC_APP_ID_SETUP.md` | Step-by-step for filling in `submit.production.ios.ascAppId` in `eas.json` | Reference |

## 1 · Privacy Manifest (`PrivacyInfo.xcprivacy`)

**Status:** production-ready, no placeholders, covers every data category LumaScout actually collects today (email, name, precise location, photos, user content, purchase history, user ID, crash, performance).

### How to wire it into the iOS build

Expo SDK 54 doesn't auto-inject `.xcprivacy` files yet. The safest path is **prebuild + one-time copy**:

```bash
cd /app/frontend
npx expo prebuild --platform ios --clean
cp /app/app-store-assets/PrivacyInfo.xcprivacy \
   ios/LumaScout/PrivacyInfo.xcprivacy
```

Then in Xcode verify **Build Phases → Copy Bundle Resources** lists the file for the main app target. (If it doesn't, drag it in once and commit the `.pbxproj` delta.)

After that, `eas build --platform ios` will pick it up automatically on every build.

### What's declared

- **Tracking:** `NSPrivacyTracking = false`, `NSPrivacyTrackingDomains = []` — we do no cross-app tracking.
- **Collected data types (all linked to user identity, none used for tracking):**
  - Email address (auth)
  - Name (profile display)
  - Precise location (nearby spots)
  - Photos / videos (uploader)
  - Other user content (posts, notes)
  - Purchase history (Stripe subscription tier)
  - User ID (stable uuid)
  - Crash data (analytics purpose; not currently wired but declared)
  - Performance data (analytics purpose)
- **Required-reason APIs:** `UserDefaults (CA92.1)`, `FileTimestamp (C617.1)`, `SystemBootTime (35F9.1)`, `DiskSpace (E174.1)`.

If you add any new SDK (Sentry, Mixpanel, Branch, etc.) the reviewer may require additional categories — extend the `NSPrivacyAccessedAPITypes` or `NSPrivacyCollectedDataTypes` arrays accordingly.

---

## 2 · ASC App ID — how to fill in `eas.json`

See `ASC_APP_ID_SETUP.md` (same folder). Short version:

1. Log into https://appstoreconnect.apple.com with the team owning bundle `com.lumascout.app`.
2. **My Apps** → **+ → New App**. Platform: iOS. Bundle ID: `com.lumascout.app`.
3. After creating the record, go to **App Information**. Copy the **Apple ID** (a 10-digit number, e.g. `6476543210`).
4. Paste that number into `/app/frontend/eas.json` → `submit.production.ios.ascAppId`.
5. Commit. `eas submit --platform ios --profile production` will now work.

**Do NOT guess the Apple ID.** It has to be the one ASC assigns when the app record is created.
