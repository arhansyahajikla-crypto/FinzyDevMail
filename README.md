# FinzyDevMail — siap hosting

## Deploy paling mudah: Render
1. Upload project ini ke GitHub.
2. Di Render pilih **New > Blueprint** dan pilih repository.
3. Render akan membaca `render.yaml`.
4. Isi `ADMIN_EMAIL` dan `ADMIN_PASSWORD` pada Environment Variables.
5. Deploy.
6. Buka URL `https://finzydevmail-....onrender.com` yang diberikan Render.

`JWT_SECRET` dibuat otomatis oleh Render. Database SQLite disimpan di persistent disk `/app/data`.

## Deploy dengan Docker
```bash
docker build -t finzydevmail .
docker run -p 3000:3000 -e JWT_SECRET="secret-panjang" -e ADMIN_EMAIL="admin@example.com" -e ADMIN_PASSWORD="password-min-8" -v finzydevmail-data:/app/data finzydevmail
```

## Fitur
- Register/login
- Dashboard, setor, riwayat, saldo, profil
- Admin review
- Audit log
- Email Checker deterministic, maksimal **300 email/check**
- Syntax + DNS + MX check
- Tidak memakai random result
- Status `UNKNOWN` bila mailbox tidak bisa dipastikan secara sah
- Health check `/health`

## Penting
Sebelum membuka layanan publik, gunakan HTTPS, secret yang kuat, rate limiting, backup database, dan monitoring. Untuk skala besar, PostgreSQL/Supabase lebih cocok daripada SQLite.
