---
status: accepted
---

# The Pulse app is a PWA with Web Push; Capacitor waits until something native is needed

Supersedes the wrapper and push parts of ADR 0011; its React (Vite) + MapLibre GL JS choice stands. The app is installed from the browser to the home screen and gets pushes through Web Push (VAPID), on iOS 16.4+ and Android alike. A native iOS app needs a paid Apple Developer account and App Store or TestFlight distribution for push, which is too much cost and friction for one maintainer. Web Push on iOS works only for home-screen apps, can arrive a little late (Briefings leave a margin for that), can't carry notification action buttons, and can't be silent: every push shows a notification, which suits a push policy that only pushes when something changes plans. Pushes pass through Apple's and Google's push services, possibly outside the EU/EEA, so a push carries only short advice text, never a location history.

## Considered options

- **Capacitor-wrapped native app (ADR 0011)** — rejected for now: paid developer account and store distribution for push. Comes back if home-screen widgets or a Live Activity are wanted.
- **A messaging bot (Telegram, ntfy)** — rejected: pushes would live outside the app, and the tap couldn't open the Trip.
