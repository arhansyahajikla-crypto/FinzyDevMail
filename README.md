# FinzyDevMail v7.5

Struktur project dirapikan menjadi frontend, backend, checker, dan database.

## Struktur

```text
FinzyDevMail/
├── backend/
│   └── server.js
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── checker/
│   ├── mailcat_gmail_runner.py
│   ├── mailcat-requirements.txt
│   └── mailcat/
├── database/
├── Dockerfile
├── package.json
└── render.yaml
```

Checker Gmail menggunakan bridge Python yang mengimpor source Mailcat yang dibundel.
