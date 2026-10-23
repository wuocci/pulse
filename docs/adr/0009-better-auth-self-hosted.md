# Self-hosted Better Auth for user accounts

Logging in is needed to save Places and Routines and to get pushes. Browsing, "Where to?" and My area for one home location work without an account. We use Better Auth, self-hosted, with users stored in the app module's tables (ADR 0010). Sign-in methods are Sign in with Apple, Google and an email magic link. Apple sign-in is mandatory on iOS once Google is offered. We picked it over hosted services like Clerk or Supabase Auth to avoid per-user costs and vendor lock-in, and to keep user data in the EU next to the rest of the system.
