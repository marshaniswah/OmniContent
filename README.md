# RADAR — Risk Analytics & Detection for Automated Retention

> **Tim:** Unlimited (Fatra Al Khawarizmi · Marshaniswah Syamsul)  
> **Institusi:** Universitas Pendidikan Indonesia (UPI) & Institut Teknologi Bandung (ITB)  
> **Tagline:** *Detect the Risk. Act Before They Leave.*

**RADAR** adalah solusi otomasi pencegahan *churn* (berhenti berlangganan) untuk penyedia layanan internet (*ISP / fixed broadband*) yang dibangun menggunakan **UiPath Maestro Flow**, **UiPath Data Fabric**, **UiPath Action Center**, **UiPath Integration Service (Gmail)**, dan **Agentic AI**.

RADAR menghubungkan data pelanggan, kualitas jaringan (*outage*, *packet loss*, *latency*), keluhan pelanggan, dan tiket gangguan yang melewati SLA ke dalam satu alur kerja otomatis yang memprioritaskan pelanggan berisiko tinggi, mengeskalasi tiket ke tim NOC, menyusun draf penawaran retensi berbasis AI dengan **guardrail kebijakan deterministik**, meminta persetujuan manusia di **Action Center**, lalu mengirimkan email tindak lanjut serta laporan eksekutif harian secara otomatis via **Gmail** — dengan seluruh jejak audit tersimpan di **Data Fabric**.

> **Catatan Data & Keamanan:** Seluruh data di dalam repositori ini 100% **data sintetis**. Tidak ada data pribadi asli, password, token, maupun API key yang disertakan.

---

## 1. Masalah & Alur Kerja End-to-End

Di banyak ISP, sinyal gangguan jaringan (NOC), keluhan pelanggan (Customer Support), dan upaya retensi berjalan terpisah. Akibatnya, pelanggan berisiko baru ditangani setelah mereka mengajukan berhenti berlangganan.

RADAR menyatukan seluruh sinyal tersebut dalam satu alur kerja otomatis:

```text
Jadwal harian otomatis (07.00) atau eksekusi manual
  -> Baca CsCustomer || Baca CsTicket terbuka || Baca CsRetentionCase (Data Fabric, paralel)
  -> Hitung fitur per pelanggan (jumlah gangguan, packet loss, latency, keluhan, tiket lewat SLA, sisa kontrak)
  -> Agen AI #1: Analisis seluruh keluhan (sentimen negatif & niat berhenti, termasuk bahasa sehari-hari; fallback kata kunci)
  -> Penilaian skor risiko churn (mode default: rules; tersedia slot external ML model dengan fallback otomatis ke rules)
  -> Prioritisasi: skor risiko x estimasi revenue tahunan (ambang batas default 0.6, Top 5 pelanggan)
       - Lewati pelanggan yang masih punya kasus aktif atau baru dihubungi dalam 30 hari terakhir (anti duplikat & anti spam)
       - Peringatan dini (early warning): daftar pelanggan berskor rendah yang sudah menyinggung niat berhenti
  -> Tandai kasus yang menunggu persetujuan melebihi SLA (24 jam) untuk supervisor
  -> Untuk setiap pelanggan prioritas (paralel):
       1. Buat catatan kasus baru di CsRetentionCase
       2. Eskalasi otomatis tiket paling lewat SLA ke tim NOC (update CsTicket -> Escalated)
       3. Agen AI #2: Susun ringkasan risiko, rekomendasi aksi, penawaran terstruktur (jenis, %, bulan, teknisi), & draf pesan
          (Jika AI gagal -> kasus diset ke Needs Manual Review; pelanggan lain tetap berjalan)
       4. Cek Policy Guardrail tahap #1 pada draf AI (ditampilkan ke reviewer)
       5. Persetujuan manusia di UiPath Action Center (reviewer bisa ubah penawaran/pesan -> Approve Offer atau No Action)
       6. Cek Policy Guardrail tahap #2 pada penawaran yang disetujui reviewer:
          - Patuh kebijakan  -> Kirim email follow-up via Gmail (jika notifyEmail diisi) -> status Follow-up Sent / Follow-up Ready
          - Di luar kebijakan -> Buat tugas Supervisor di Action Center (Approve Exception atau Reject Offer)
       7. Simpan seluruh hasil, catatan reviewer/supervisor, dan status akhir ke Data Fabric
  -> Susun laporan eksekutif harian & kirim ke manajer via Gmail Integration Service
```

**Prinsip Human-in-the-Lead:** Tidak ada penawaran retensi atau email yang dikirim ke pelanggan tanpa persetujuan eksplisit dari manusia. Baik draf AI maupun hasil edit reviewer tetap diawasi oleh guardrail kebijakan deterministik; setiap pelanggaran otomatis ditahan dan dinaikkan ke Supervisor.

---

## 2. Tools & Teknologi yang Dipakai

| Komponen | Teknologi | Peran di RADAR |
|---|---|---|
| **Orkestrasi Utama** | **UiPath Maestro Flow** (`RADAR/RADAR.flow` & `.flow-sdk/RADAR.flow.ts`) | Mengatur alur end-to-end, eksekusi paralel, percabangan kebijakan, fallback error, dan jadwal harian (`07:00`) |
| **Penyimpanan & Audit** | **UiPath Data Fabric** (`CsCustomer`, `CsTicket`, `CsRetentionCase`) | Menyimpan data pelanggan sintetis, tiket gangguan, eskalasi NOC, dan jejak audit keputusan retensi |
| **Persetujuan Manusia** | **UiPath Action Center** | Menyediakan formulir interaktif bagi Reviewer (tinjau/edit penawaran) dan Supervisor (pengecualian kebijakan) |
| **Agen AI** | **UiPath Inline AI Agents** (`anthropic.claude-sonnet-5`) | Agen #1 membaca niat berhenti pada keluhan berbahasa Indonesia; Agen #2 menyusun penawaran terstruktur & draf pesan |
| **Pengiriman Email** | **UiPath Integration Service — Gmail** (`uipath-google-gmail`) | Mengirim email tindak lanjut pelanggan & laporan eksekutif harian via OAuth (tanpa menyimpan kredensial di kode) |
| **Utilitas Data Uji** | **Python 3** (`sample-data/generate_data.py`) & **UiPath CLI (`uip`)** | Membuat dataset sintetis 150 pelanggan & 52 tiket serta mengelola setup/reset entitas Data Fabric |

---

## 3. Kebutuhan Aplikasi & Koneksi (Prasyarat)

Sebelum mereplikasi project ini, pastikan hal-hal berikut sudah tersedia:

1. **Akun UiPath Automation Cloud** (Community Edition / Enterprise) dengan layanan aktif:
   - **UiPath Studio Web** & **Maestro**
   - **UiPath Data Fabric** (pastikan sudah di-enable pada tenant Anda)
   - **UiPath Action Center**
   - **UiPath Integration Service** (opsional, diperlukan hanya jika ingin menguji pengiriman email nyata via Gmail)
2. **UiPath CLI (`uip`)** *(disarankan untuk setup entitas & import CSV cepat)* atau akses langsung melalui browser ke **UiPath Automation Cloud**.
3. **Python 3.9+** *(opsional, hanya jika ingin men-generate ulang CSV data sintetis; file `customers.csv` dan `tickets.csv` siap pakai sudah tersedia di folder `sample-data/`)*.
4. **Koneksi OAuth Gmail di Integration Service** *(opsional)*:
   - Pada paket source code ini, ID koneksi Gmail diset ke placeholder `00000000-0000-0000-0000-000000000000` agar tidak menyertakan ID akun pribadi.
   - Jika Anda ingin mengirim email nyata, cukup buat koneksi Gmail di Integration Service lalu pilih koneksi Anda pada aktivitas Gmail di Studio Web.
   - Jika Anda belum ingin menghubungkan Gmail, biarkan input `notifyEmail` kosong (`""`) — robot tetap berjalan penuh hingga status `Follow-up Ready` tanpa error.

---

## 4. Panduan Replikasi Langkah demi Langkah

Ikuti langkah berikut untuk menjalankan RADAR dari awal di tenant UiPath Anda:

### Langkah 1 — Ekstrak Source Code
Ekstrak file `Unlimited_RADAR_SourceCode.zip`. Struktur folder di dalamnya:

```text
RADAR/
├── README.md                          # Panduan replikasi ini
├── RADAR.uipx                         # Manifest solusi UiPath
├── RADAR/
│   ├── RADAR.flow                     # Workflow Maestro Flow siap pakai
│   ├── project.uiproj                 # Manifest project Maestro
│   ├── bindings_v2.json               # Deklarasi binding koneksi & jadwal harian
│   ├── operate.json                   # Konfigurasi operasi flow
│   ├── .flow-sdk/
│   │   ├── RADAR.flow.ts              # Source code TypeScript flow
│   │   ├── bindings.json              # Mapping binding SDK
│   │   └── connectors*/               # Definisi konektor Gmail
│   ├── 43838e2e-.../agent.json        # Konfigurasi Agen AI #1 (Analisis Keluhan)
│   ├── dde85ea2-.../agent.json        # Konfigurasi Agen AI #2 (Rekomendasi Retensi)
│   └── evals/                         # Konfigurasi evaluasi agen
├── resources/                         # Metadata resource solusi UiPath
├── sample-data/
│   ├── entity_CsCustomer.json         # Skema entitas Data Fabric: CsCustomer
│   ├── entity_CsTicket.json           # Skema entitas Data Fabric: CsTicket
│   ├── entity_CsRetentionCase.json    # Skema entitas Data Fabric: CsRetentionCase
│   ├── customers.csv                  # 150 data pelanggan sintetis siap import
│   ├── tickets.csv                    # 52 data tiket gangguan sintetis siap import
│   ├── input-sample.json              # Contoh parameter input eksekusi
│   ├── output-sample.md               # Contoh output hasil run aktual
│   ├── generate_data.py               # Generator data sintetis
│   └── reset-demo-data.sh             # Skrip reset tiket & kasus sebelum demo ulang
└── docs/
    ├── RADAR_PRD.md                   # Product Requirements Document
    └── RADAR_URD.md                   # User Requirements Document
```

### Langkah 2 — Login ke UiPath & Buat 3 Entitas Data Fabric
Masuk ke tenant UiPath Anda lewat CLI (atau buat manual lewat menu **Data Fabric → Entities** di browser menggunakan file JSON skema):

```bash
# 1. Login ke UiPath Automation Cloud
uip login

# 2. Buat 3 entitas Data Fabric dari file skema di sample-data/
uip df entities create CsCustomer --file sample-data/entity_CsCustomer.json
uip df entities create CsTicket --file sample-data/entity_CsTicket.json
uip df entities create CsRetentionCase --file sample-data/entity_CsRetentionCase.json

# 3. Cek ID masing-masing entitas yang baru dibuat
uip df entities list
```

### Langkah 3 — Import Data Sintetis ke Data Fabric
File `sample-data/customers.csv` (150 pelanggan) dan `sample-data/tickets.csv` (52 tiket terbuka) sudah siap dipakai. Import ke entitas yang baru dibuat:

```bash
# Ganti <ID_CsCustomer> dan <ID_CsTicket> dengan ID dari hasil `uip df entities list`
uip df records import <ID_CsCustomer> --file sample-data/customers.csv
uip df records import <ID_CsTicket> --file sample-data/tickets.csv
```

*(Alternatif via browser: buka **Data Fabric → CsCustomer → Data → Import from CSV**, pilih `sample-data/customers.csv`, lalu ulangi untuk `CsTicket` dengan `sample-data/tickets.csv`. Entitas `CsRetentionCase` dibiarkan kosong karena akan diisi otomatis oleh robot.)*

*(Opsional: jika ingin membuat ulang CSV sintetis, jalankan `python sample-data/generate_data.py sample-data`.)*

### Langkah 4 — Import & Buka Project di UiPath Studio Web
1. Buka **UiPath Automation Cloud → Studio Web**.
2. Pilih **Import** dan unggah paket solusi ini (atau buka `RADAR.uipx` melalui ekstensi UiPath di VS Code, lalu deploy/debug ke tenant Anda).
3. Buka file workflow utama: **`RADAR/RADAR.flow`**.
4. *(Opsional untuk pengiriman email nyata)*:
   - Buka **Integration Service → Connectors → Gmail**, klik **Add Connection** dan login dengan akun Google uji coba Anda.
   - Kembali ke `RADAR/RADAR.flow`, klik 3 node Gmail (`sendFollowUpEmail`, `sendExceptionEmail`, `sendRunReportEmail`) lalu pilih koneksi Gmail yang baru Anda buat.

### Langkah 5 — Jalankan Robot (`Run / Debug`)
1. Klik **Debug** (atau **Run**) pada `RADAR/RADAR.flow`.
2. Masukkan parameter input sesuai contoh di `sample-data/input-sample.json` (seluruh parameter sudah memiliki nilai bawaan):

```json
{
  "riskThreshold": 0.6,
  "topN": 5,
  "scoringMode": "rules",
  "externalModelUrl": "",
  "contactCooldownDays": 30,
  "approvalSlaHours": 24,
  "notifyEmail": ""
}
```

> **Tips Uji Gmail:** Isi `"notifyEmail": "email-uji-anda@contoh.com"` untuk melihat pengiriman email follow-up pelanggan dan laporan eksekutif harian secara langsung. Biarkan kosong (`""`) untuk menjalankan mode tanpa email.

### Langkah 6 — Jalankan Persetujuan Manusia di UiPath Action Center
Setelah robot membaca Data Fabric, menjalankan Agen AI, dan mengeskalasi tiket lewat SLA, alur akan berhenti pada tahap **Human-in-the-Lead**:

1. Buka **UiPath Action Center** (atau klik panel tugas pada node `retentionReview` di Studio Web).
2. Akan muncul 5 tugas berjudul **`RADAR: review retention offer`** (1 tugas per pelanggan prioritas).
3. Pada setiap tugas, Anda dapat menguji skenario berikut:
   - **Skenario Patuh Kebijakan (*Compliant*):** Tinjau alasan risiko & draf AI, ubah jenis/angka penawaran dalam batas kebijakan (misalnya `Diskon 20%` selama `3 bulan`), lalu klik **Approve Offer**.
   - **Skenario Pelanggaran Kebijakan (*What-If Guardrail*):** Sengaja ubah ke `Diskon 50%` selama `6 bulan` (atau `Diskon 0%` tanpa mengisi persentase), lalu klik **Approve Offer**. Guardrail kedua akan otomatis menahan pengiriman email dan memunculkan tugas baru **`RADAR: penawaran di luar kebijakan`** untuk Supervisor. Buka tugas Supervisor tersebut lalu pilih **Approve Exception** (dengan alasan) atau **Reject Offer**.
   - **Skenario Tanpa Tindakan:** Klik **No Action** agar kasus ditutup tanpa menghubungi pelanggan.

### Langkah 7 — Verifikasi Hasil Akhir & Reset Demo
1. **Data Fabric → `CsTicket`:** Pastikan tiket pelanggan prioritas yang melewati SLA telah berubah menjadi `TicketStatus = Escalated`, `Escalated = true`, lengkap dengan `EscalationNote`.
2. **Data Fabric → `CsRetentionCase`:** Pastikan seluruh kasus tercatat lengkap dengan skor, alasan, status (`Follow-up Sent` / `Follow-up Ready` / `Closed - No Action` / `Closed - Offer Rejected`), status kebijakan, serta catatan reviewer & supervisor.
3. **Gmail (jika `notifyEmail` diisi):** Periksa email follow-up pelanggan yang disetujui serta **Laporan Eksekutif Harian RADAR** yang memuat ringkasan KPI, daftar kasus, dan kotak **Peringatan Dini AI**.
4. **Reset untuk Demo Ulang:** Sebelum mengulang pengujian dari kondisi awal yang bersih, jalankan:
   ```bash
   bash sample-data/reset-demo-data.sh
   ```

---

## 5. Daftar Parameter Input & Aturan Policy Guardrail

### Parameter Input Flow
| Parameter | Default | Fungsi |
|---|---|---|
| `riskThreshold` | `0.6` | Batas minimum skor churn untuk dikategorikan risiko tinggi |
| `topN` | `5` | Jumlah pelanggan prioritas teratas yang diproses per run |
| `scoringMode` | `"rules"` | Mode penilaian: `"rules"` (default) atau `"external"` (API model ML eksternal) |
| `externalModelUrl` | `""` | Endpoint HTTP POST model ML eksternal (otomatis *fallback* ke `rules` jika gagal/kosong) |
| `contactCooldownDays` | `30` | Jeda hari minimum sebelum pelanggan yang sudah dihubungi boleh diproses ulang |
| `approvalSlaHours` | `24` | Batas jam tunggu persetujuan sebelum ditandai `ApprovalOverdue = true` |
| `notifyEmail` | `""` | Alamat email tujuan uji coba pengiriman Gmail (kosongkan untuk berhenti di `Follow-up Ready`) |

### Aturan Deterministik Policy Guardrail (Tahap #1 & #2)
Penawaran berbentuk terstruktur sehingga aturan diperiksa secara eksak pada draf AI maupun hasil edit reviewer:

| Aturan Kebijakan | Contoh yang Langsung Ditahan Guardrail |
|---|---|
| Jenis penawaran hanya `Diskon`, `Upgrade Kecepatan`, atau `Bulan Gratis` (+ opsional teknisi prioritas) | Mengetik jenis di luar daftar (mis. `"Cashback"`) |
| Hanya boleh memilih satu jenis penawaran | Menggabungkan upgrade + diskon 20% |
| Diskon maksimal **30%**, maksimal **3 bulan**, dan persentase wajib diisi (`> 0`) | Diskon 50% selama 6 bulan, atau Diskon 0% |
| Upgrade kecepatan maksimal **3 bulan** | Upgrade kecepatan selama 6 bulan |
| Bulan gratis maksimal **1 bulan**, khusus sisa kontrak **≤ 1 bulan** | 2 bulan gratis, atau 1 bulan gratis saat kontrak masih 6 bulan |
| Isi teks pesan harus sinkron dengan angka penawaran | Menulis *"diskon 50%"* atau *"1 bulan gratis"* padahal penawaran di form berbeda |
| Larangan janji berlebihan yang tidak bisa dijamin | Kata *"dijamin"*, *"bebas gangguan"*, *"tidak akan ada gangguan"* |
| Pesan tindak lanjut tidak boleh kosong dan maksimal **150 kata** | Pesan kosong atau terlalu panjang |

---

## 6. Contoh Output Aktual & Skenario Teruji (Data Sintetis)

Seluruh hasil di bawah ini adalah hasil eksekusi aktual pada dataset sintetis 150 pelanggan & 52 tiket (detail lengkap tersedia di `sample-data/output-sample.md`):

- **Run End-to-End Gmail (`RUN-20261124-033424`):**
  > `150` pelanggan dinilai (`rules`, keluhan dibaca AI), `21` berisiko tinggi dengan total *revenue at risk* `Rp 150.600.000/tahun`. `5` kasus prioritas diproses: `5` tiket lewat SLA dieskalasi ke NOC, `5/5` email tindak lanjut terkirim via Gmail (`Rp 57.000.000/tahun` ditawari retensi, termasuk `1` pengecualian supervisor), `0` tanpa tindakan. Peringatan dini AI: `4` pelanggan berskor rendah (`0.10`) terdeteksi menanyakan denda berhenti langganan.
- **Uji Guardrail Supervisor (`Approve Exception` & `Reject Offer`):** Pelanggaran angka diskon (`50% / 6 bulan` maupun `Diskon 0%`) serta kontradiksi teks pesan vs form berhasil ditahan guardrail kedua dan dialihkan ke tugas Supervisor.
- **Uji Ketahanan (*Fallback & Exception Handling*):**
  - Model AI tidak valid → analisis keluhan otomatis fallback ke daftar kata kunci; kasus pelanggan bermasalah ditandai `Needs Manual Review` dan pelanggan lain tetap berjalan hingga selesai.
  - Endpoint `externalModelUrl` tidak terjangkau → otomatis fallback ke rule-based scoring dan dicatat pada laporan.
  - Eksekusi tumpang tindih → pelanggan yang masih memiliki kasus aktif atau dalam masa cooldown 30 hari otomatis dilewati (anti duplikat & anti spam), dan kasus lewat SLA 24 jam ditandai `ApprovalOverdue`.

---

## 7. Ruang Lingkup Jujur (*Honest Scope*) & Kompilasi Ulang

- **Data Sintetis & Kalibrasi Skor:** Bobot skor pada mode `rules` disusun berbasis penilaian domain untuk demonstrasi prototipe (belum dilatih pada data historis pelanggan riil). Penyedia layanan dapat menghubungkan model ML internal melalui slot `externalModelUrl`.
- **Istilah Revenue:** Karena status retensi akhir membutuhkan integrasi sistem billing/CRM produksi ISP, laporan menggunakan istilah *"revenue at risk"* dan *"revenue ditawari retensi"* — bukan klaim *"revenue terselamatkan"*.
- **Kompilasi Ulang dari TypeScript (Opsional):** Jika Anda memodifikasi `RADAR/.flow-sdk/RADAR.flow.ts`, kompilasi dan validasi ulang dari dalam folder `RADAR/` dengan:
  ```bash
  uip maestro flow compile .flow-sdk/RADAR.flow.ts -o RADAR.flow
  uip maestro flow format RADAR.flow
  uip maestro flow validate RADAR.flow
  ```
