# ASC App ID Setup — how to unblock `eas submit`

> **Status (Batch #7, May 2026):** `eas.json` still has `ascAppId: "PLACEHOLDER"`. Filling this in is a one-time, user-only action; cannot be automated by the codebase.

## 1 · What is the ASC App ID?

It is the numeric Apple ID assigned to your app when you first create its App Store Connect record. NOT the same as:

| Field | Example | Where it lives |
|---|---|---|
| **Bundle ID** | `com.lumascout.app` | `app.json` → `expo.ios.bundleIdentifier` (already set) |
| **Apple Team ID** | `23H3KJ9VVC` | `eas.json` → `appleTeamId` (already set) |
| **ASC App ID** | `6476543210` (10 digits) | `eas.json` → `submit.production.ios.ascAppId` (**empty — you fill this in**) |

## 2 · How to obtain it

1. Open https://appstoreconnect.apple.com and sign in with the Apple ID that owns the `23H3KJ9VVC` team.
2. Click **My Apps → “+” → New App**.
3. Fill in the form:
   - **Platform**: iOS
   - **Name**: LumaScout (or your preferred display name; you can change it up until first submission)
   - **Primary language**: English (U.S.)
   - **Bundle ID**: `com.lumascout.app` (must already be registered in Apple Developer → Certificates, IDs & Profiles → Identifiers; Expo creates this automatically on the first EAS build)
   - **SKU**: any unique internal string, e.g. `lumascout-ios-prod`
   - **User Access**: Full Access
4. Click **Create**.
5. On the new app page, expand **General Information → App Information**.
6. Scroll to the **Apple ID** field — it's a 10-digit number. Copy it.

## 3 · Where to paste it

Edit `/app/frontend/eas.json`:

```jsonc
{
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "6476543210",      // <- paste here (no quotes around the number if you want, but string is fine)
        "appleTeamId": "23H3KJ9VVC"
      }
    }
  }
}
```

Commit the change. `eas submit --platform ios --profile production` will now upload the binary to the matching App Store Connect record.

## 4 · Common gotchas

- If `eas submit` says *"Could not find a matching app in App Store Connect with bundle ID com.lumascout.app"*, the app record wasn't created yet — repeat step 2.
- If it says *"The provided Apple ID doesn't have access to this app"*, verify the Apple account has been added as a team member in App Store Connect with the **Admin** or **App Manager** role for this team.
- The ASC App ID is different for every team / every app record. If you later move the app to a different Apple team, the ASC App ID changes.
