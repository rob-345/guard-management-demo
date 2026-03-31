# Hikvision Value Series ISAPI

This Bruno collection is for the Hikvision terminal directly, not the app-level API.

Use `environments/local.bru` as the starting point, then fill in:

- `device_host`
- `username`
- `password`
- `security`
- `iv`
- `subscribe_event_id`
- `challenge_modulus_b64`
- `activation_password_payload`

The `Alert stream` request is a long-lived stream, so it may stay open until you cancel it manually.
