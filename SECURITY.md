# Security Notes

Pratiksha is designed for local operation. Treat the repository as source code only; runtime state belongs outside git.

Never commit:

- `.env`
- Postgres data
- WhatsApp adapter authentication stores
- Uploaded or shareable files
- Local model blobs
- Container logs and backups

The dashboard may inspect or deny file requests, but successful file sends must be confirmed by the trusted recipient in WhatsApp. This prevents an owner-side dashboard action from sending a file while the owner is away.
