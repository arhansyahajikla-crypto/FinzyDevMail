# Database

FinzyDevMail memakai SQLite melalui `DB_FILE`.

- Local default: `/app/data/finzydevmail.db` saat container berjalan.
- Railway/production: mount persistent disk ke `/app/data`.
- Folder ini sengaja tidak menyimpan database runtime di repository.
