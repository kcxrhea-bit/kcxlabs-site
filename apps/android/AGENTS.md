# KCx Labs Android companion rules

This directory is the Android Media Center companion. It is a Capacitor client of the existing KCx Labs API.

- Keep Android code isolated here; never import Electron main-process code.
- Do not change API routes, database schema, R2 credentials, retention/archive behavior, public routing, Nexus, or desktop behavior for mobile presentation work.
- Device tokens belong only in Android Keystore-backed secure storage. Never log, export, or show the token or owner password.
- Use Android's system document picker for media; do not request broad storage permissions.
- Keep user-facing workflows understandable: pairing, online media, upload, recovery, sharing, and destructive removal must each explain outcome, risk, recovery, and next step.
- Update the in-app Help tab whenever a user-facing workflow, setting, permission, error, or feature changes. It must work offline inside the packaged app.
- Preserve the KCx dark/orange visual identity and use clear status/action hierarchy.
- Before handing off: run typecheck, web build, Capacitor sync, relevant Android build if available, and git diff --check. Do not commit, push, deploy, or install without explicit user authorization.
