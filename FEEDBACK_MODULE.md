# Customer Feedback Module

This module adds outlet-based QR feedback with smart routing:

- `4-5` overall: customer is prompted to leave a Google review.
- `1-3` overall: customer is prompted to contact support via WhatsApp/call.

## URLs

- Customer feedback form:
  - `/Tracker/feedback/index.html?outlet=OUTLET_NAME`
- Outlet QR generator page:
  - `/Tracker/feedback/qr.html`
- Superadmin dashboard:
  - `/Tracker/feedback/dashboard.html`

## API Endpoints

- Public config:
  - `/Tracker/api/feedback-public-config.php`
- Submit feedback:
  - `/Tracker/api/feedback-submit.php`
- Admin API:
  - `/Tracker/api/feedback-admin.php`

## Admin Login

Dashboard login requires:

1. A `superadmin` username from app users.
2. Dashboard passcode.

Passcode source:

- `FEEDBACK_ADMIN_PASSCODE` environment variable (if set), otherwise
- `/Tracker/data/feedback_admin_config.json` (`adminPasscode`).

Default passcode on first run: `change-me-now`.
Change it immediately from dashboard `Change Passcode`.

