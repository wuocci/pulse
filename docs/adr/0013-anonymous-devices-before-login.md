---
status: accepted
---

# The app module keeps anonymous Devices, not users, until login is needed

Changes ADR 0009 and ADR 0010 for now: Places, Routines and push subscriptions belong to a Device, an anonymous app install that registers once and gets an ID, with no login. The app promises "no account", and a Device holds even less than a user would: no name, no email, only Routines and a push subscription. A Device renews its Routines whenever the app is opened; Routines not renewed for 60 days, or whose push subscription stops working, are deleted with their Watches. Better Auth (ADR 0009) stays the choice for when login arrives, for example to share Routines between devices; Devices then attach to a user.

## Considered options

- **Login first (ADR 0009 as written)** — rejected: an account wall for a one-person, tailnet-only app, and more personal data than the feature needs.
- **Everything on the phone, no server state** — rejected: a Briefing must run on the server while the app is closed, so the server has to know the Routine and where to push.
