# Sample output (real debug runs on our tenant, synthetic data)

## Current version: AI complaint analysis, structured offers, AI failure handling

**Run G** `RUN-20261122-025712`, default inputs:

> RADAR RUN-20261122-025712: 150 pelanggan dinilai (rules, keluhan dibaca AI), 21 berisiko tinggi dengan revenue at risk Rp 150.600.000/tahun. 5 kasus baru diproses: 5 tiket dieskalasi, 4 penawaran disetujui (Rp 45.600.000/tahun ditawari retensi), 1 tanpa tindakan. Peringatan dini: 4 pelanggan berskor rendah menyebut niat berhenti di keluhannya.

"Ditawari retensi" is the annual revenue of customers with an approved offer. Whether they stay is not tracked yet.

| Customer | Churn score | Ticket escalated | AI draft (structured) | Reviewer | Stored decision / status |
|---|---|---|---|---|---|
| CUST-0070 Teguh Saputra | 0.91 Very High | Yes | Gratis 1 bulan langganan + kunjungan teknisi prioritas | Approve | Approved / Follow-up Ready |
| CUST-0072 Arif Anggraini | 0.84 Very High | Yes | Upgrade kecepatan gratis selama 3 bulan + kunjungan teknisi prioritas | Approve | Approved / Follow-up Ready |
| CUST-0038 Ayu Nugroho | 0.82 Very High | Yes | Gratis 1 bulan langganan + kunjungan teknisi prioritas | Changed to Diskon 20% / 3 bulan, message adjusted | Approved / Follow-up Ready (Compliant) |
| CUST-0125 Budi Hidayat | 0.79 Very High | Yes | Upgrade kecepatan gratis selama 3 bulan + kunjungan teknisi prioritas | Approve | Approved / Follow-up Ready |
| CUST-0100 Indra Kusuma | 0.90 Very High | Yes | Gratis 1 bulan langganan + kunjungan teknisi prioritas | No Action | No Action / Closed - No Action |

**Example reasons (CUST-0022, run E):** 9 gangguan dalam 30 hari; packet loss rata-rata 3.95%; latency rata-rata 191 ms; 3 keluhan dalam 30 hari; AI: keluhan menunjukkan niat berhenti: "Sudah tiga kali janji teknisi, tidak ada yang datang. Kalau bulan depan masih begini saya stop langganan"; tiket TKT-00007 lewat SLA; kontrak sudah habis bulan ini.

**Early warning list (report `earlyWarningIntent`):** CUST-0010, CUST-0019, CUST-0050, CUST-0054, each score 0.10, complaint "Mau tanya, kalau berhenti langganan sebelum kontrak habis kena denda berapa?".

**AI complaint analysis vs keyword list, same 47 complaints:**

| | Customers |
|---|---|
| Flagged by AI, missed by keywords | CUST-0022 "stop langganan", CUST-0038 "mending cabut aja", CUST-0110 / 0117 / 0125 "provider sebelah", CUST-0143 "sinyal hilang tiap hujan" |
| Flagged by keywords only (false alarm: "lagi" contains "lag") | CUST-0003, 0061, 0092, 0124, 0136 "Internet lagi bagus kok, cuma mau tanya ..." |

The complaint texts were written by us for the demo, so this illustrates the behaviour; it is not a measured accuracy.

**Run E** `RUN-20261122-025204`, `topN = 3`, reviewer and supervisor decisions:

| Customer | Reviewer action | Policy re-check | Supervisor | Stored decision / status |
|---|---|---|---|---|
| CUST-0070 | Approve AI draft (1 free month, contract 0 months left) | Compliant | — | Approved / Follow-up Ready |
| CUST-0022 | Offer fields set to Diskon 50%, 6 months | "diskon 50% melebihi batas 30%; durasi 6 bulan melebihi batas 3 bulan" | Approve Exception | Approved (Exception) / Follow-up Ready, PolicyStatus `Exception Approved` |
| CUST-0100 | Offer fields set to Diskon 20%, 3 months, but the AI message promising "1 bulan gratis" kept | "pesan menawarkan bulan gratis di luar penawaran" | Reject Offer | Rejected by Supervisor / Closed - Offer Rejected |

> RADAR RUN-20261122-025204: ... 3 kasus baru diproses: 3 tiket dieskalasi, 2 penawaran disetujui (Rp 22.800.000/tahun ditawari retensi, 1 lewat pengecualian supervisor), 1 ditolak supervisor, 0 tanpa tindakan. ...

**Run F** `RUN-20261122-025500`, `topN = 1`, built with a deliberately invalid model id to test failure handling:

> RADAR RUN-20261122-025500: 150 pelanggan dinilai (rules, keluhan dibaca kata kunci), ... 1 kasus baru diproses: 1 tiket dieskalasi, 0 penawaran disetujui (Rp 0/tahun ditawari retensi), 1 perlu ditangani manual karena AI gagal, 0 tanpa tindakan. 2 pelanggan berisiko dilewati karena sudah punya kasus atau masih masa jeda kontak. Catatan: Analisis keluhan AI gagal; sinyal keluhan memakai daftar kata kunci.

Case CUST-0072: status `Needs Manual Review`, decision `AI Failed`, note "Rekomendasi AI gagal: Failure in the Orchestrator Job. Tangani manual." Run status Completed.

**Fallback run** (`scoringMode = external`, unreachable URL): report note "External model failed; rule-based scores were used."

---

## Earlier version (free-text offer): duplicate protection and SLA

These runs used the previous build, where the offer was free text and the report said "dilindungi"
(now "ditawari retensi"). The duplicate protection and SLA logic is unchanged.

**Run B** `RUN-20261121-162104`, started while the previous run's 5 tasks were still open (`approvalSlaHours = 0`, `topN = 3`):

> ... 3 kasus baru diproses: 3 tiket dieskalasi, 2 penawaran disetujui (Rp 22.800.000/tahun dilindungi), 1 tanpa tindakan. 5 pelanggan berisiko dilewati karena sudah punya kasus atau masih masa jeda kontak. 5 approval lewat SLA 0 jam ditandai untuk supervisor.

Skipped: CUST-0070, CUST-0022, CUST-0100, CUST-0072, CUST-0038, each "kasus Pending Approval (RUN-20261121-162007)". Their 5 cases now have `ApprovalOverdue = true`.

**Run C** `RUN-20261121-163102`, `topN = 1`: reviewer edits CUST-0150's offer to "Gratis 2 bulan + upgrade kecepatan"; supervisor task lists 3 violations; Reject Offer.
Skip reasons in the report: "kasus Follow-up Ready (RUN-...)" for approved customers, "sudah ditangani 0 hari lalu" for closed ones.

**Run D** `RUN-20261121-163305`, `topN = 1`: CUST-0150 (rejected in Run C, never contacted) is picked again with a new compliant offer, approved, Follow-up Ready.
