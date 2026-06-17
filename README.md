# BackEnd-Dokter — API Server Aplikasi Mobile Dokter SIMRS

Backend khusus untuk **CareDoc EMR** (aplikasi mobile dokter), berisi endpoint yang dibutuhkan aplikasi Flutter dokter. Berjalan di port **4002**.

## Requirements

- **Bun** 1.0+ (runtime utama) atau **Node.js** 18+
- **MySQL** 8.0+ (database SIMRS)
- **Redis** (opsional — untuk rate limiter IP)

## Quick Start

```bash
cd BackEnd-Dokter
cp .env.example .env   # atau edit langsung file .env
bun install
bun run dev            # Development (hot reload)
```

Server berjalan di **http://localhost:4002**

## Konfigurasi `.env`

| Variable | Keterangan |
|---|---|
| `PORT` | Port server (default: `4002`) |
| `DB_HOST` | Host database MySQL SIMRS |
| `DB_PORT` | Port MySQL (default: `3306`) |
| `DB_USER` | Username database |
| `DB_PASS` | Password database |
| `DB_NAME` | Nama database SIMRS |
| `SECRETTOKEN` | JWT secret key (harus sama dengan backend utama) |
| `DB_AES_KEY_USER` | AES key decrypt username |
| `DB_AES_KEY_PASS` | AES key decrypt password |
| `HOST_WEB` | URL web server (untuk path gambar radiologi, contoh: `http://192.168.6.201`) |
| `HOST_WEB_PORT` | Port web server (contoh: `80`) |
| `HOST_WEB_ROOT` | Root folder web (contoh: `webapps`) |
| `REDIS_HOST` | Host Redis |
| `REDIS_PORT` | Port Redis (default: `6379`) |
| `REDIS_PASSWORD` | Password Redis |
| `DB_CONNECTION_LIMIT` | Maks koneksi pool DB (default: `3`) |
| `ALLOWED_ORIGINS` | CORS whitelist (pisah koma) |

## Deployment PM2

```bash
# Production
pm2 start ecosystem.config.js --env production

# Developer
npm run dev
bun run dev

# Restart
pm2 restart backend-dokter

# Monitor
pm2 logs backend-dokter
pm2 monit
```

## API Endpoints

### Auth & Setting
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| `POST` | `/api/auth/login` | ❌ | Login dokter |
| `GET` | `/api/setting` | ✅ | Info rumah sakit |
| `GET` | `/api/health` | ❌ | Health check server |

### Dashboard
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| `GET` | `/api/list-pasien-ranap` | ✅ | Daftar pasien rawat inap |
| `GET` | `/api/list-pasien-ralan` | ✅ | Daftar pasien rawat jalan |
| `GET` | `/api/list-pasien-igd` | ✅ | Daftar pasien IGD |
| `GET` | `/api/jadwal/operasi` | ✅ | Jadwal operasi hari ini |
| `GET` | `/api/jadwal/bed` | ✅ | Ketersediaan bed |

### Rekam Medis
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| `GET` | `/api/riwayat/pasien/medis-ranap` | ✅ | Riwayat medis RANAP |
| `GET` | `/api/riwayat/pasien/medis-ranap-neonatus` | ✅ | Medis neonatus |
| `GET` | `/api/riwayat/pasien/medis-ranap-kebidanan` | ✅ | Medis kebidanan |
| `GET` | `/api/riwayat/pasien/medis-igd` | ✅ | Riwayat medis IGD |
| `GET` | `/api/riwayat/pasien/soap-ralan` | ✅ | SOAP rawat jalan |
| `GET` | `/api/riwayat/pasien/soap-ranap` | ✅ | SOAP rawat inap |
| `GET` | `/api/riwayat/pasien/diagnosa` | ✅ | Diagnosa ICD-10 |
| `GET` | `/api/riwayat/pasien/pemberian-obat` | ✅ | Riwayat pemberian obat |
| `GET` | `/api/riwayat/pasien/laboratorium` | ✅ | Hasil laboratorium |
| `GET` | `/api/riwayat/pasien/radiologi` | ✅ | Hasil + gambar radiologi |
| `GET` | `/api/riwayat/pasien/total-tagihan` | ✅ | Total tagihan billing |
| `GET` | `/api/perkiraan-biaya` | ✅ | Estimasi biaya BPJS |

### SBAR & DPJP
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| `GET` | `/api/pemeriksaan` | ✅ | List SBAR pasien ranap |
| `POST` | `/api/pemeriksaan/validasi` | ✅ | Validasi SBAR |
| `GET` | `/api/dpjp-ranap` | ✅ | List DPJP pasien |
| `POST` | `/api/dpjp-ranap` | ✅ | Set sebagai DPJP |

> ✅ = Membutuhkan `Authorization: Bearer <token>` di header

## Query Parameters Umum

Sebagian besar endpoint menerima:

| Parameter | Keterangan |
|---|---|
| `no_rawat` | Nomor rawat pasien |

Contoh:
```
GET /api/riwayat/pasien/laboratorium?no_rawat=2024/RANAP/000123
```

## Struktur File

```
BackEnd-Dokter/
├── app.js                          # Entry point (Bun/Hono)
├── ecosystem.config.js             # PM2 config
├── .env                            # Konfigurasi environment
├── config/
│   ├── db.js                       # Pool koneksi MySQL
│   └── redis.js                    # Koneksi Redis
├── loaders/
│   └── hono.js                     # Setup middleware Hono
├── middleware/                     # JWT, asyncHandler, logger, dll
├── repositories/                   # Query builder DB level bawah
├── services/                       # Business logic
├── controllers/
│   ├── main/                       # Auth, setting, list pasien, jadwal, DPJP
│   ├── rekammedis/
│   │   ├── riwayat/                # Semua controller riwayat pasien
│   │   └── pemeriksaan/            # Controller SBAR
│   └── keuangan/                   # Perkiraan biaya BPJS
└── routes/
    ├── main/indexRoute.js          # Router utama (entry semua endpoint)
    ├── rekammedis/                 # Route rekam medis & SBAR
    └── keuangan/                   # Route perkiraan biaya
```

## Health Check

```bash
curl http://localhost:4002/api/health
```

Response sukses:
```json
{
  "code": 200,
  "success": true,
  "data": {
    "server": "healthy",
    "database": "healthy",
    "uptime": "...",
    "memory": { ... }
  }
}
```

## ☕ Dukung Pengembang

Jika tools ini membantu Anda atau rumah sakit Anda, Anda bisa memberikan dukungan melalui:

[![Dukung via Saweria](https://img.shields.io/badge/Saweria-Dukung%20Saya-orange?style=for-the-badge&logo=heart)](https://saweria.co/marufp1605)

---

## 🤝 Kustomisasi & Kerja Sama Profesional

Jika membutuhkan kustomisasi tersendiri atau kerja sama profesional, silakan hubungi:
- **Telepon/WhatsApp:** [085232406085](https://wa.me/6285232406085)
- **Telegram:** [@m_putra_s](https://t.me/m_putra_s)

---

## 📄 Lisensi

Proyek ini dikembangkan untuk internal **RS Islam Aminah Blitar**.  
Hak cipta © 2024–2026 Tim IT SIMRS RSI Aminah.
