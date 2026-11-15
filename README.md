# Form & Function

A mobile-first personal progress tracker for posture habits, mobility, strength, recovery and self-care. The deployable web app lives in `www/`. The original root-level PWA files are retained as a fallback.

## Current architecture

- **GitHub:** source code
- **Vercel:** hosts the web app from `www/`
- **Supabase:** optional account and private cloud backup
- **Capacitor:** packages the same web app as an Android application
- **Local storage:** keeps a local copy so the tracker remains usable when cloud sync is unavailable

## 1. Deploy to Vercel

1. Sign in at https://vercel.com using GitHub.
2. Choose **Add New → Project**.
3. Import `studymaterialaryan05-ai/form-function-tracker`.
4. Framework preset: **Other**.
5. Build command: leave empty.
6. Output directory: `www`.
7. Click **Deploy**.

Every push to `main` can trigger a fresh deployment. See https://vercel.com/docs/git.

## 2. Create the Supabase project

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor → New query**.
3. Copy all of `supabase/schema.sql` into the editor and run it.
4. Open **Project Settings → API** (or the Connect dialog).
5. Copy the Project URL and the publishable key (or legacy anon key).
6. Edit `www/supabase-config.js` in GitHub.
7. Replace `YOUR_SUPABASE_PROJECT_URL` and `YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY` with those two values, then commit.
8. In Supabase **Authentication → URL Configuration**, add your Vercel production URL to Site URL and Redirect URLs.
9. For personal use, you can disable email confirmation under Authentication → Providers → Email while testing, or keep it enabled and confirm your email.

**Security:** the publishable/anon key is designed for browser use when Row Level Security is enabled. Never use or expose a `service_role` or secret key in this repository or in the APK. The SQL enables RLS and limits each signed-in user to their own row.

The app currently keeps local data and syncs a single JSON backup row per signed-in user. When signing in on a new device, cloud data is merged with local data. Keep using Export backup as an additional backup. This is an early personal-use sync implementation, not a conflict-resolution system for simultaneous editing on multiple devices.

## 3. Build the Android APK on Windows

Install:
- Node.js 22 or later: https://nodejs.org/
- Android Studio: https://developer.android.com/studio
- Git for Windows: https://git-scm.com/download/win

Then open **PowerShell** and run:

```powershell
git clone https://github.com/studymaterialaryan05-ai/form-function-tracker.git
cd form-function-tracker
npm install
npx cap add android
npx cap sync android
npx cap open android
```

Android Studio opens the native project. Allow it to install the Android SDK components it requests. Connect your Android phone with USB debugging enabled, or use an emulator, then press **Run** to test.

To create an APK in Android Studio:
1. Select **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
2. When the build finishes, click **locate** in the notification.
3. The debug APK is usually under `android/app/build/outputs/apk/debug/app-debug.apk`.

For a distributable signed APK, use **Build → Generate Signed Bundle / APK → APK** and create a signing key. Keep that key and its password private and backed up.

## 4. Updating the app

After web changes are committed, Vercel deploys the website. For changes to the native APK, pull the latest code on Windows and run:

```powershell
npm install
npx cap sync android
```

Then rebuild the APK in Android Studio.

## Privacy and health note

Tracker entries may contain health-related notes. Use a strong unique password and do not share your account. The tracker is not a diagnostic tool or a prescribed rehabilitation plan. With a previous ACL injury, get individual exercise clearance from a qualified sports physiotherapist or orthopaedic clinician before progressing loaded knee exercises. Stop and seek assessment for giving-way, locking, swelling, sharp pain, numbness or weakness.
