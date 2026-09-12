# mobile — RTE IMS companion app (Flutter, Android)

Thin native client for the same API as the web app.

**Students:** Home (next exam seat + latest published result), My results (by semester), My exam seats (venue, seat, mini room grid), Notifications, Profile.
**Staff:** approval queue → sheet summary with computed outcomes and statistical flags → approve / return with reason / publish / request correction.

- Tokens in `flutter_secure_storage`; last successful response per screen cached in `shared_preferences` so the app opens offline with an "Offline · last synced" banner.
- On launch it calls `/health` (3 s timeout) and shows "Server waking up…" while a scaled-to-zero API starts.
- API base URL: build-time `--dart-define=API_URL=https://…`, overridable at runtime in **Settings** (useful for a laptop on the venue Wi-Fi; the Android emulator reaches the host at `http://10.0.2.2:8080`).

```bash
flutter pub get
flutter run                                             # emulator/device, points at http://10.0.2.2:8080
flutter build apk --release --dart-define=API_URL=https://<antideploy-app-url>
# → build/app/outputs/flutter-apk/app-release.apk (attach to the GitHub Release; never commit it)
```

Debug signing is used for the release APK; no keystore is committed.
