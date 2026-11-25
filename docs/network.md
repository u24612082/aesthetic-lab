# Private Mac server and phone sync

The desktop listener remains `127.0.0.1:8765` over HTTP. **Setup iPhone Access.command** creates a second HTTPS listener on the Mac’s explicit private Wi-Fi IPv4 address, port 8443, with a stable `.local` hostname. Both listeners share one application process, one worker and one SQLite WAL database. Wildcard, public and plaintext LAN binds are refused.

The setup script generates a private ECDSA root and a 365-day server certificate under `certs/`. Root identity is reused when setup is rerun; key files are mode 0600 and excluded from the source archive. It does not alter the Mac Keychain. Only the public `iphone.mobileconfig` profile is sent to the phone and trusted through iOS Settings. See [the phone guide](iphone-setup.md).

The phone listener watches the configured interface and rebinds when its private IP changes. The hostname certificate and desktop address stay the same. If your Wi-Fi interface is different, run `.venv/bin/python scripts/setup_phone.py --interface en1` and restart the service. Guest/client-isolated Wi-Fi can prevent communication. Allow Python incoming access in the macOS firewall if prompted on your own trusted network. No public port forwarding or Tailscale setup is needed for offline gym logging followed by home sync.

Authentication uses an HttpOnly SameSite cookie, a private long token, or a one-use six-digit code that expires in five minutes. Codes are HMAC-hashed in SQLite and rate limited. API writes reject foreign Origins; Hosts are allowlisted and proxy headers disabled. No token appears in QR URLs, IndexedDB or localStorage. Rotate APP_TOKEN and restart to revoke sessions. Phone caches do contain personal training/food records; keep the device and installed app secure.

The service worker caches only application assets. The app separately stores downloaded food/reference data and safe read snapshots in IndexedDB, alongside an immutable food outbox. Workout snapshots and their merge baseline are written together to one atomic localStorage envelope. The standalone app reuses its device identifier across cold launches; desktop tabs retain independent pending drafts. Live `/api/data` reads never fall back to stale API cache. API 401 responses do not use offline read fallbacks.

Food changes replay through `/api/offline/changes/{uuid}`. Validation, stale-record checks, mutation and idempotency receipt commit in one SQLite transaction. Independent completed workouts merge against the last synced baseline; overlapping changes stop for review. The lightweight diary refresh brings the other device’s entries back to the phone without re-downloading the full food library every time. Offline sync retries while the app is open; it does not rely on iOS background execution.

## Mac background service and backups

Use `.venv/bin/python scripts/launchagent.py install|status|uninstall`. The per-user LaunchAgent starts at login and restarts after crashes; a sleeping Mac is unavailable. Logs are in `var/logs/`. Keep this workspace in place after installing the service.

Keep APP_DB on the Mac’s local disk. Never put the live SQLite/WAL/SHM files in iCloud, Dropbox or a shared network folder. The optional legacy APP_INBOX transports workout JSON only, not live database files. It is disabled in native tracker mode.

Use `.venv/bin/python scripts/backup.py var/backups/backup.sqlite3` for a consistent live backup, then copy that completed backup to iCloud if desired. Restore only with the service stopped and all database connections closed, preserving the existing database/WAL/SHM together first.
