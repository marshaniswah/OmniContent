/**
 * RADAR — churn prevention automation for fixed broadband (PRD/URD v1.0)
 *
 * daily schedule / manual run
 *   -> read customers || read open tickets || read existing cases (Data Fabric, parallel)
 *   -> build features -> AI complaint analysis (sentiment + intent to leave; keyword fallback)
 *   -> scoring slot (explainable rules by default; external ML endpoint with fallback)
 *   -> prioritize by churn score x revenue at risk (threshold, top N),
 *      skipping customers with an open case or contacted within the cooldown
 *   -> flag approvals waiting past the SLA
 *   -> per customer (parallel): open case -> escalate overdue ticket
 *        -> AI retention recommendation (structured offer) -> policy guardrail check
 *        -> human approval (edit offer fields and message / approve / no action)
 *        -> approved version re-checked; out-of-policy offers need a supervisor exception
 *        -> case updated; if the AI step fails the case goes to manual review and the run continues
 *   -> run report from the recorded cases
 *
 * Data is synthetic. No customer is contacted without approval.
 */
import {
  flow, scheduled, script, inlineAgent, hitl, http, connector,
  dataFabricRead, dataFabricCreate, dataFabricUpdate,
  out, v, lit, js, err, types,
} from "@uipath/maestro-builder-sdk";
import { SendEmail } from "./connectors-local/uipath-google-gmail.ts";

const MODEL = "anthropic.claude-sonnet-5";
const item = (field: string) => v(`eachCustomer.currentItem.${field}`);

const OFFER_OPTIONS = [
  { id: "offer-discount", value: "Diskon", label: "Diskon" },
  { id: "offer-upgrade", value: "Upgrade Kecepatan", label: "Upgrade Kecepatan" },
  { id: "offer-free", value: "Bulan Gratis", label: "Bulan Gratis" },
];

// FR-11 offer policy guardrail. The offer is STRUCTURED (type, percent, months, technician visit), so
// the rules are exact; the follow-up message is checked so it cannot promise more than the offer.
// Policy: one offer type only — discount <= 30% for <= 3 months, OR free speed upgrade <= 3 months,
// OR 1 free month only when <= 1 contract month is left; a priority technician visit may be added.
// (Kept free of backslashes so it embeds safely in script code.)
const POLICY_FN = `
  function offerText(type, pct, months, visit) {
    const p = Number(pct || 0), n = Number(months || 0);
    const t = type === "Diskon" ? "Diskon " + p + "% selama " + n + " bulan"
      : type === "Upgrade Kecepatan" ? "Upgrade kecepatan gratis selama " + n + " bulan"
      : type === "Bulan Gratis" ? "Gratis " + n + " bulan langganan"
      : "Jenis penawaran tidak dikenal (" + type + ")";
    return (visit === true || visit === "true") ? t + " + kunjungan teknisi prioritas" : t;
  }
  function checkPolicy(type, pct, months, visit, message, contractLeft) {
    const issues = [];
    const p = Number(pct || 0), n = Number(months || 0);
    if (["Diskon", "Upgrade Kecepatan", "Bulan Gratis"].indexOf(type) < 0) issues.push("jenis penawaran harus Diskon, Upgrade Kecepatan, atau Bulan Gratis");
    if (n < 1) issues.push("durasi penawaran minimal 1 bulan");
    if (type === "Diskon") {
      if (p <= 0) issues.push("persentase diskon belum diisi");
      if (p > 30) issues.push("diskon " + p + "% melebihi batas 30%");
      if (n > 3) issues.push("durasi " + n + " bulan melebihi batas 3 bulan");
    } else if (p > 0) {
      issues.push("diskon " + p + "% digabung dengan " + type + " (hanya boleh satu jenis penawaran)");
    }
    if (type === "Upgrade Kecepatan" && n > 3) issues.push("upgrade " + n + " bulan melebihi batas 3 bulan");
    if (type === "Bulan Gratis") {
      if (n > 1) issues.push("gratis " + n + " bulan melebihi batas 1 bulan");
      if (Number(contractLeft) > 1) issues.push("bulan gratis hanya untuk kontrak <= 1 bulan (sisa kontrak " + contractLeft + " bulan)");
    }
    // the follow-up message must not promise more than the structured offer
    const m = String(message || "").toLowerCase();
    if (m.trim() === "") issues.push("pesan follow-up kosong");
    (m.match(/[0-9]+ *(%|persen)/g) || []).map((x) => parseInt(x, 10)).forEach((x) => {
      if (type !== "Diskon" || x !== p) issues.push("pesan menyebut " + x + "% yang tidak sama dengan penawaran");
    });
    if ((m.match(/persen/g) || []).length > (m.match(/[0-9]+ *persen/g) || []).length) issues.push("pesan menyebut potongan tanpa angka yang jelas");
    ["setengah harga", "separuh harga", "gratis selamanya", "gratis seumur", "selamanya gratis", "harga khusus selamanya"].forEach((w) => {
      if (m.indexOf(w) >= 0) issues.push("pesan menjanjikan '" + w + "' di luar penawaran");
    });
    (m.match(/selama *[0-9]+ *bulan/g) || []).map((x) => parseInt(x.replace("selama", ""), 10)).forEach((x) => {
      if (x !== n) issues.push("pesan menyebut durasi " + x + " bulan, penawaran " + n + " bulan");
    });
    if (type === "Diskon" && (m.match(/gratis *[0-9]+ *bulan|[0-9]+ *bulan *gratis/g) || []).length) issues.push("pesan menawarkan bulan gratis di luar penawaran");
    ["dijamin", "tidak akan ada gangguan", "tidak akan terjadi gangguan", "bebas gangguan", "pasti stabil", "100% stabil", "uang kembali"].forEach((w) => {
      if (m.indexOf(w) >= 0) issues.push("janji yang tidak bisa dijamin: '" + w + "'");
    });
    const words = m.split(" ").filter((x) => x.trim() !== "").length;
    if (words > 150) issues.push("pesan follow-up terlalu panjang (" + words + " kata, maks 150)");
    return { status: issues.length ? "Violation" : "Compliant", issues: issues.length ? issues.join("; ") : "sesuai kebijakan",
      offer: offerText(type, p, n, visit) };
  }
  function escHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function buildCustomerEmailHtml(name, code, plan, city, offer, message, ticketCode, isException) {
    const safeMsg = escHtml(message).split(String.fromCharCode(10)).join("<br/>");
    const ticketRow = ticketCode
      ? "<tr><td style='padding:5px 12px 5px 0;color:#64748b;font-size:13px;white-space:nowrap;'>Tiket gangguan</td><td style='padding:5px 0;color:#111827;font-size:13px;'>" + escHtml(ticketCode) + " &mdash; diprioritaskan ke tim teknis</td></tr>"
      : "";
    return "<div style='margin:0;padding:20px 12px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;'>"
      + "<div style='max-width:560px;margin:0 auto;'>"
      + "<div style='border-bottom:2px solid #0062cc;padding-bottom:10px;margin-bottom:20px;'>"
      + "<span style='font-size:14px;font-weight:700;color:#0e1721;letter-spacing:0.3px;'>Tim Layanan Pelanggan</span>"
      + "</div>"
      + "<p style='margin:0 0 16px 0;font-size:14.5px;line-height:1.65;color:#1f2937;'>" + safeMsg + "</p>"
      + "<table cellspacing='0' cellpadding='0' style='width:100%;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:18px 0;padding:8px 0;'>"
      + "<tr><td style='padding:5px 12px 5px 0;color:#64748b;font-size:13px;white-space:nowrap;'>Penawaran</td><td style='padding:5px 0;color:#111827;font-size:13px;font-weight:600;'>" + escHtml(offer) + "</td></tr>"
      + "<tr><td style='padding:5px 12px 5px 0;color:#64748b;font-size:13px;white-space:nowrap;'>Pelanggan</td><td style='padding:5px 0;color:#111827;font-size:13px;'>" + escHtml(name) + " (" + escHtml(code) + ") &middot; " + escHtml(plan) + "</td></tr>"
      + ticketRow
      + "</table>"
      + "<p style='margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#374151;'>Apabila Bapak/Ibu ingin mengatur jadwal kunjungan teknisi atau membutuhkan bantuan lebih lanjut, silakan balas langsung email ini agar tim kami segera membantu.</p>"
      + "<p style='margin:0;font-size:14px;line-height:1.6;color:#111827;'>Salam hangat,<br/><strong>Tim Retensi &amp; Layanan Pelanggan</strong></p>"
      + "<div style='margin-top:24px;padding-top:10px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8;'>Ref: " + escHtml(code) + " &middot; " + escHtml(city) + "</div>"
      + "</div></div>";
  }
`;

export default flow("f10cb1af-e962-41ad-aba8-40d250ac2453")
  .schemaVersion("1.9")
  .name("RADAR")
  // Configuration: manual runs may override; the daily schedule uses the defaults.
  .var("cfgThreshold", types.number, 0.6)
  .var("cfgTopN", types.number, 5)
  .var("cfgMode", types.string, "rules")
  .var("cfgModelUrl", types.string, "")
  .var("cfgCooldownDays", types.number, 30)
  .var("cfgSlaHours", types.number, 24)
  .var("cfgNotifyEmail", types.string, "")
  .input({
    riskThreshold: { type: types.number, default: 0.6, shared: "cfgThreshold" },
    topN: { type: types.number, default: 5, shared: "cfgTopN" },
    scoringMode: { type: types.string, default: "rules", shared: "cfgMode" }, // rules | external
    externalModelUrl: { type: types.string, default: "", shared: "cfgModelUrl" },
    contactCooldownDays: { type: types.number, default: 30, shared: "cfgCooldownDays" },
    approvalSlaHours: { type: types.number, default: 24, shared: "cfgSlaHours" },
    notifyEmail: { type: types.string, default: "", shared: "cfgNotifyEmail" },
  })
  .entryPoint("dailyRun", scheduled({ every: "0 0 7 * * ?" }))
  .output({
    runId: types.string,
    scoringModeUsed: types.string,
    summary: types.string,
    customersScored: types.number,
    highRiskCount: types.number,
    revenueAtRisk: types.number,
    report: types.object,
  })
  .var("scored", types.array, [])
  .var("scoringUsed", types.string, "rules")
  .var("scoringNote", types.string, "")
  .var("complaintMode", types.string, "keyword")
  .var("aiNegative", types.string, "")
  .var("aiIntent", types.string, "")
  .var("complaintNote", types.string, "")

  .step("newRun", script({
    code: `
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return "RUN-" + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-" +
        p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
    `,
    returns: "string",
  }))

  // FR-01 ingestion: customers, open tickets and existing cases are independent reads
  .parallel("ingest", [
    (a) => a.step("readCustomers", dataFabricRead({
      entity: "CsCustomer", resultMode: "multiple", limit: 1000,
      sort: { field: "CustomerCode" },
    })),
    (b) => b.step("readTickets", dataFabricRead({
      entity: "CsTicket", resultMode: "multiple", limit: 1000,
      filters: [{ field: "TicketStatus", value: "Open" }],
      sort: { field: "OpenedAt" },
    })),
    // existing cases: duplicate protection, contact cooldown and approval SLA
    (c) => c.step("readCases", dataFabricRead({
      entity: "CsRetentionCase", resultMode: "multiple", limit: 1000,
      sort: { field: "CreateTime", direction: "desc" },
    })),
  ])

  // FR-02 feature building
  .step("buildFeatures", script({
    code: `
      const customers = $vars.readCustomers.output.results || [];
      const tickets = $vars.readTickets.output.results || [];
      const now = Date.now();
      const byCustomer = {};
      for (const t of tickets) {
        const hoursOpen = (now - new Date(t.OpenedAt).getTime()) / 3600000;
        const overdueBy = hoursOpen - Number(t.SlaHours || 0);
        const row = { id: t.Id, code: t.TicketCode, category: t.Category, overdueBy: overdueBy };
        (byCustomer[t.CustomerCode] = byCustomer[t.CustomerCode] || []).push(row);
      }
      const features = customers.map((c) => {
        const open = byCustomer[c.CustomerCode] || [];
        const overdue = open.filter((t) => t.overdueBy > 0).sort((x, y) => y.overdueBy - x.overdueBy);
        const worst = overdue[0];
        return {
          customerCode: c.CustomerCode, customerName: c.CustomerName, servicePlan: c.ServicePlan,
          monthlyFee: Number(c.MonthlyFee || 0), city: c.City, contactEmail: c.ContactEmail,
          tenureMonths: Number(c.TenureMonths || 0), contractMonthsLeft: Number(c.ContractMonthsLeft || 0),
          outages30d: Number(c.Outages30d || 0), avgPacketLoss: Number(c.AvgPacketLoss || 0),
          avgLatencyMs: Number(c.AvgLatencyMs || 0), complaints30d: Number(c.Complaints30d || 0),
          lastComplaint: c.LastComplaint || "",
          openTickets: open.length, overdueTickets: overdue.length,
          overdueTicketId: worst ? worst.id : "", overdueTicketCode: worst ? worst.code : "",
          overdueTicketCategory: worst ? worst.category : "",
          hoursOverdue: worst ? Math.round(worst.overdueBy) : 0,
          revenueAtRisk: Number(c.MonthlyFee || 0) * 12
        };
      });
      const complaintLines = features.filter((f) => String(f.lastComplaint).trim() !== "")
        .map((f) => f.customerCode + " | " + f.lastComplaint).join("\\n");
      return { features: features, customerCount: features.length, openTicketCount: tickets.length,
        complaintLines: complaintLines };
    `,
    returns: { features: "array", customerCount: "number", openTicketCount: "number", complaintLines: "string" },
  }))

  // FR-02a AI complaint analysis: reads the free-text complaints in one call (sentiment and intent to leave).
  // If the AI is unavailable the score falls back to the keyword list, and the report says so.
  .step("analyzeComplaints", inlineAgent({
    model: MODEL,
    systemPrompt:
      "Kamu menganalisis keluhan pelanggan ISP di Indonesia, termasuk bahasa gaul dan sindiran. " +
      "Setiap baris berformat 'KODE | teks keluhan'. Nilai setiap keluhan HANYA dari teksnya. " +
      "Negatif: pelanggan kesal, kecewa, atau mengeluhkan layanan (bukan sekadar bertanya). " +
      "Niat berhenti: pelanggan menyebut, menyiratkan, atau menanyakan berhenti langganan, pindah provider, " +
      "membandingkan dengan provider lain, atau mengancam berhenti (misalnya 'cabut', 'stop langganan', 'provider sebelah'). " +
      "Pertanyaan biasa atau ucapan terima kasih bukan negatif. Kata 'lagi' bukan 'lag'. " +
      "Return a result conforming to the output schema. " +
      "negativeCodes: kode pelanggan yang keluhannya negatif, dipisah koma, kosong bila tidak ada. " +
      "churnIntentCodes: kode pelanggan yang menunjukkan niat berhenti (negatif atau tidak), dipisah koma, kosong bila tidak ada. " +
      "notes: 1-2 kalimat pola utama keluhan.",
    userPrompt: "Keluhan pelanggan:\n{{input.complaints}}",
    inputs: { complaints: out("buildFeatures", "complaintLines") },
    returns: { negativeCodes: "string", churnIntentCodes: "string", notes: "string" },
  }), {
    updates: {
      complaintMode: lit("ai"),
      aiNegative: out("analyzeComplaints", "negativeCodes"),
      aiIntent: out("analyzeComplaints", "churnIntentCodes"),
      complaintNote: out("analyzeComplaints", "notes"),
    },
  })
  .onError((h) =>
    h
      .step("complaintFallback", script({
        code: `return "Analisis keluhan AI gagal; sinyal keluhan memakai daftar kata kunci";`,
        returns: "string",
      }), { updates: { complaintNote: out("complaintFallback"), complaintMode: lit("keyword") } })
      .stepToRef("scoreRules"),
  )

  // FR-03 scoring slot, default implementation: explainable rule-based score
  .step("scoreRules", script({
    code: `
      const negative = ["pindah provider", "kecewa", "putus", "berhenti", "lag", "terganggu"];
      const codes = (s) => String(s || "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => x !== "");
      const aiMode = $vars.complaintMode === "ai";
      const aiNeg = codes($vars.aiNegative), aiIntent = codes($vars.aiIntent);
      const scored = $vars.buildFeatures.output.features.map((f) => {
        const reasons = [];
        let s = 0;
        const add = (w, why) => { if (w > 0) { s += w; reasons.push(why); } };
        add(Math.min(f.outages30d / 6, 1) * 0.25, f.outages30d + " gangguan dalam 30 hari");
        add(Math.min(f.avgPacketLoss / 5, 1) * 0.15 * (f.avgPacketLoss >= 2 ? 1 : 0), "packet loss rata-rata " + f.avgPacketLoss + "%");
        add(Math.min(Math.max(f.avgLatencyMs - 60, 0) / 150, 1) * 0.10, "latency rata-rata " + f.avgLatencyMs + " ms");
        add(Math.min(f.complaints30d / 4, 1) * 0.15 * (f.complaints30d >= 2 ? 1 : 0), f.complaints30d + " keluhan dalam 30 hari");
        let intent = false;
        if (aiMode) {
          intent = aiIntent.indexOf(f.customerCode) >= 0;
          if (intent) add(0.10, "AI: keluhan menunjukkan niat berhenti: \\"" + f.lastComplaint + "\\"");
          else if (aiNeg.indexOf(f.customerCode) >= 0) add(0.07, "AI: keluhan bernada negatif: \\"" + f.lastComplaint + "\\"");
        } else {
          const text = String(f.lastComplaint).toLowerCase();
          if (negative.some((w) => text.indexOf(w) >= 0)) add(0.10, "keluhan bernada negatif (kata kunci): \\"" + f.lastComplaint + "\\"");
        }
        if (f.overdueTickets > 0) add(0.15, "tiket " + f.overdueTicketCode + " lewat SLA " + f.hoursOverdue + " jam");
        if (f.contractMonthsLeft <= 0) add(0.10, "kontrak sudah habis bulan ini");
        else if (f.contractMonthsLeft <= 1) add(0.10, "kontrak habis dalam 1 bulan");
        else if (f.contractMonthsLeft <= 3) add(0.05, "kontrak habis dalam " + f.contractMonthsLeft + " bulan");
        if (f.tenureMonths < 6) add(0.05, "pelanggan baru (" + f.tenureMonths + " bulan)");
        const score = Math.round(Math.min(s, 1) * 100) / 100;
        return Object.assign({}, f, {
          churnScore: score, churnIntent: intent,
          riskLevel: score >= 0.75 ? "Very High" : score >= 0.6 ? "High" : score >= 0.35 ? "Medium" : "Low",
          reasons: reasons.length ? reasons.join("; ") : "tidak ada sinyal risiko signifikan"
        });
      });
      return { scored: scored };
    `,
    returns: { scored: "array" },
  }), { updates: { scored: out("scoreRules", "scored"), scoringUsed: lit("rules") } })

  // FR-03 scoring slot, external model: same contract, falls back to rules on failure
  .branch(
    "useExternalModel",
    js`$vars.cfgMode === "external" && $vars.cfgModelUrl !== ""`,
    (ext) =>
      ext
        .step("callModel", http({
          managed: true,
          method: "POST",
          url: v("cfgModelUrl"),
          body: js`({ customers: $vars.buildFeatures.output.features })`,
          returns: { scores: "array" },
        }))
        .onError((h) =>
          h
            .step("modelFallback", script({
              code: `return "External model failed; rule-based scores were used";`,
              returns: "string",
            }), { updates: { scoringNote: out("modelFallback") } })
            .stepToRef("prioritize"),
        )
        .step("mergeModelScores", script({
          code: `
            const byCode = {};
            for (const s of ($vars.callModel.output.body.scores || [])) byCode[s.customerCode] = s;
            let matched = 0;
            const scored = $vars.scored.map((r) => {
              const m = byCode[r.customerCode];
              if (!m) return r;
              matched++;
              const score = Math.round(Number(m.churnScore) * 100) / 100;
              return Object.assign({}, r, {
                churnScore: score,
                riskLevel: score >= 0.75 ? "Very High" : score >= 0.6 ? "High" : score >= 0.35 ? "Medium" : "Low",
                reasons: (m.topReasons || []).join("; ") || r.reasons
              });
            });
            return { scored: scored, note: "External model scored " + matched + " customers" };
          `,
          returns: { scored: "array", note: "string" },
        }), {
          updates: {
            scored: out("mergeModelScores", "scored"),
            scoringUsed: lit("external"),
            scoringNote: out("mergeModelScores", "note"),
          },
        }),
  )

  // FR-04 prioritization, FR-12 no duplicate cases / contact cooldown, FR-13 approval SLA
  .step("prioritize", script({
    code: `
      const threshold = Number($vars.cfgThreshold);
      const topN = Math.max(0, Math.floor(Number($vars.cfgTopN)));
      const now = Date.now();
      const cooldownMs = Math.max(0, Number($vars.cfgCooldownDays)) * 86400000;
      const slaMs = Math.max(0, Number($vars.cfgSlaHours)) * 3600000;
      const openStatuses = ["Analyzing", "Pending Approval", "Follow-up Ready", "Needs Manual Review"];
      const cases = $vars.readCases.output.results || [];
      const blocked = {};
      const overdue = [];
      for (const c of cases) {
        const age = now - new Date(c.CreateTime).getTime();
        const open = openStatuses.indexOf(c.CaseStatus) >= 0;
        // a supervisor-rejected offer never reached the customer, so it does not start the contact cooldown
        const contacted = c.CaseStatus !== "Closed - Offer Rejected";
        if (open || (contacted && age < cooldownMs)) {
          if (!blocked[c.CustomerCode]) blocked[c.CustomerCode] = open ? "kasus " + c.CaseStatus + " (" + c.RunId + ")" : "sudah ditangani " + Math.floor(age / 86400000) + " hari lalu";
        }
        if (c.CaseStatus === "Pending Approval" && age >= slaMs && c.ApprovalOverdue !== true) {
          overdue.push({ id: c.Id, customerCode: c.CustomerCode, customerName: c.CustomerName, runId: c.RunId, hoursWaiting: Math.floor(age / 3600000) });
        }
      }
      const high = $vars.scored.filter((r) => r.churnScore >= threshold);
      high.sort((a, b) => (b.churnScore * b.revenueAtRisk) - (a.churnScore * a.revenueAtRisk));
      const eligible = high.filter((r) => !blocked[r.customerCode]);
      const skipped = high.filter((r) => blocked[r.customerCode]).map((r) => ({ customer: r.customerCode + " " + r.customerName, reason: blocked[r.customerCode] }));
      const top = eligible.slice(0, topN);
      const total = high.reduce((s, r) => s + r.revenueAtRisk, 0);
      // early warning: the score is still low, but the AI read an intent to leave in the complaint
      const hiddenIntent = $vars.scored.filter((r) => r.churnIntent && r.churnScore < threshold)
        .map((r) => ({ customer: r.customerCode + " " + r.customerName, churnScore: r.churnScore, complaint: r.lastComplaint }));
      return { top: top, highRiskCount: high.length, highRiskRevenue: total, scoredCount: $vars.scored.length,
        skipped: skipped, overdue: overdue, hiddenIntent: hiddenIntent };
    `,
    returns: { top: "array", highRiskCount: "number", highRiskRevenue: "number", scoredCount: "number", skipped: "array", overdue: "array", hiddenIntent: "array" },
  }))

  // FR-13 approval SLA: cases still waiting for a reviewer past the SLA are flagged for the supervisor
  .loop("eachOverdue", js`$vars.prioritize.output.overdue`, (body) =>
    body.step("flagOverdue", dataFabricUpdate({
      entity: "CsRetentionCase",
      record: { byId: v("eachOverdue.currentItem.id") },
      set: { ApprovalOverdue: true },
    })),
  )

  // per prioritized customer, in parallel: each one is an independent case
  .loop("eachCustomer", js`$vars.prioritize.output.top`, (body) =>
    body
      // FR-08 case record
      .step("openCase", dataFabricCreate({
        entity: "CsRetentionCase",
        values: {
          RunId: out("newRun"),
          CustomerCode: item("customerCode"),
          CustomerName: item("customerName"),
          ChurnScore: item("churnScore"),
          RiskLevel: item("riskLevel"),
          TopReasons: item("reasons"),
          RevenueAtRisk: item("revenueAtRisk"),
          ScoringMode: v("scoringUsed"),
          TicketEscalated: js`$vars.eachCustomer.currentItem.overdueTicketId !== ""`,
          CaseStatus: "Analyzing",
        },
      }))

      // FR-05 escalate the most overdue ticket of this customer
      .branch(
        "hasOverdueTicket",
        js`$vars.eachCustomer.currentItem.overdueTicketId !== ""`,
        (yes) =>
          yes.step("escalateTicket", dataFabricUpdate({
            entity: "CsTicket",
            record: { byId: item("overdueTicketId") },
            set: {
              TicketStatus: "Escalated",
              Escalated: true,
              EscalationNote: js`"RADAR " + $vars.newRun.output + ": pelanggan " + $vars.eachCustomer.currentItem.customerCode +
                " risiko churn " + $vars.eachCustomer.currentItem.churnScore + " (" + $vars.eachCustomer.currentItem.riskLevel +
                "), revenue at risk Rp " + $vars.eachCustomer.currentItem.revenueAtRisk + "/tahun, lewat SLA " +
                $vars.eachCustomer.currentItem.hoursOverdue + " jam. Prioritaskan penanganan."`,
            },
          })),
      )

      // FR-06 AI retention recommendation (inputs prepared as plain references for the agent)
      .step("agentContext", script({
        code: `
          const c = $vars.eachCustomer.currentItem;
          return {
            name: c.customerName, plan: c.servicePlan, fee: String(c.monthlyFee), city: c.city,
            tenure: String(c.tenureMonths), contractLeft: String(c.contractMonthsLeft),
            outages: String(c.outages30d), packetLoss: String(c.avgPacketLoss), latency: String(c.avgLatencyMs),
            complaints: String(c.complaints30d), lastComplaint: c.lastComplaint || "-",
            ticket: c.overdueTicketCode === "" ? "tidak ada" :
              c.overdueTicketCode + " (" + c.overdueTicketCategory + ", lewat SLA " + c.hoursOverdue + " jam, sudah dieskalasi ke NOC)",
            score: String(c.churnScore), level: c.riskLevel, reasons: c.reasons
          };
        `,
        returns: {
          name: "string", plan: "string", fee: "string", city: "string", tenure: "string", contractLeft: "string",
          outages: "string", packetLoss: "string", latency: "string", complaints: "string", lastComplaint: "string",
          ticket: "string", score: "string", level: "string", reasons: "string",
        },
      }))
      .step("recommend", inlineAgent({
        model: MODEL,
        systemPrompt:
          "Kamu adalah analis retensi pelanggan ISP fixed broadband di Indonesia. " +
          "Gunakan HANYA data pelanggan yang diberikan. Jangan menjanjikan hal yang tidak bisa dijamin " +
          "(misalnya 'tidak akan ada gangguan lagi'); jangan memakai kata 'dijamin'. " +
          "Kebijakan penawaran, pilih SATU jenis: 'Diskon' maksimal 30% selama maksimal 3 bulan, " +
          "ATAU 'Upgrade Kecepatan' gratis selama maksimal 3 bulan, ATAU 'Bulan Gratis' 1 bulan hanya untuk sisa kontrak <= 1 bulan. " +
          "Kunjungan teknisi prioritas boleh ditambahkan bila ada gangguan jaringan. " +
          "Return a result conforming to the output schema. " +
          "riskSummary: 1-2 kalimat ringkasan risiko. " +
          "recommendedAction: langkah retensi yang disarankan untuk tim. " +
          "offerType: tepat salah satu dari 'Diskon', 'Upgrade Kecepatan', 'Bulan Gratis'. " +
          "discountPercent: persen diskon bila offerType 'Diskon', selain itu 0. " +
          "durationMonths: lama penawaran dalam bulan. " +
          "technicianVisit: true bila menambahkan kunjungan teknisi prioritas. " +
          "followUpMessage: pesan follow-up ke pelanggan dalam Bahasa Indonesia yang sopan dan hangat, mengakui gangguan " +
          "yang dialami, menyebut tindak lanjut teknis bila ada tiket, dan menawarkan penawaran itu dengan angka yang sama persis; " +
          "jangan menyebut angka persen lain (misalnya packet loss); maksimal 90 kata, tanpa tanda tangan nama orang.",
        userPrompt:
          "Nama: {{input.name}}\nPaket: {{input.plan}} (Rp {{input.fee}}/bulan)\nKota: {{input.city}}\n" +
          "Lama berlangganan: {{input.tenure}} bulan, sisa kontrak: {{input.contractLeft}} bulan\n" +
          "Gangguan 30 hari: {{input.outages}}, packet loss: {{input.packetLoss}}%, latency: {{input.latency}} ms\n" +
          "Keluhan 30 hari: {{input.complaints}}, keluhan terakhir: {{input.lastComplaint}}\n" +
          "Tiket lewat SLA: {{input.ticket}}\nSkor churn: {{input.score}} ({{input.level}})\nAlasan: {{input.reasons}}",
        inputs: {
          name: out("agentContext", "name"), plan: out("agentContext", "plan"), fee: out("agentContext", "fee"),
          city: out("agentContext", "city"), tenure: out("agentContext", "tenure"),
          contractLeft: out("agentContext", "contractLeft"), outages: out("agentContext", "outages"),
          packetLoss: out("agentContext", "packetLoss"), latency: out("agentContext", "latency"),
          complaints: out("agentContext", "complaints"), lastComplaint: out("agentContext", "lastComplaint"),
          ticket: out("agentContext", "ticket"), score: out("agentContext", "score"),
          level: out("agentContext", "level"), reasons: out("agentContext", "reasons"),
        },
        returns: {
          riskSummary: "string", recommendedAction: "string", offerType: "string", discountPercent: "number",
          durationMonths: "number", technicianVisit: "boolean", followUpMessage: "string",
        },
      }))
      // the AI failing for one customer must not stop the others: the case goes to manual review
      .onError((h) =>
        h
          .step("aiFailedCase", dataFabricUpdate({
            entity: "CsRetentionCase",
            record: { byId: out("openCase", "Id") },
            set: {
              CaseStatus: "Needs Manual Review",
              Decision: "AI Failed",
              ReviewerNote: js`"Rekomendasi AI gagal: " + (${err("recommend", "message")} || "tidak diketahui") + ". Tangani manual."`,
            },
          }))
          .continue(),
      )
      // FR-11 guardrail on the AI draft: the reviewer sees the result before deciding
      .step("policyCheck", script({
        code: POLICY_FN + `
          const r = $vars.recommend.output;
          return checkPolicy(r.offerType, r.discountPercent, r.durationMonths, r.technicianVisit, r.followUpMessage,
            $vars.eachCustomer.currentItem.contractMonthsLeft);
        `,
        returns: { status: "string", issues: "string", offer: "string" },
      }))
      .step("markPending", dataFabricUpdate({
        entity: "CsRetentionCase",
        record: { byId: out("openCase", "Id") },
        set: {
          CaseStatus: "Pending Approval",
          RecommendedAction: out("recommend", "recommendedAction"),
          OfferDetail: out("policyCheck", "offer"),
          OfferType: out("recommend", "offerType"),
          DiscountPercent: out("recommend", "discountPercent"),
          OfferMonths: out("recommend", "durationMonths"),
          TechnicianVisit: out("recommend", "technicianVisit"),
          FollowUpMessage: out("recommend", "followUpMessage"),
          PolicyStatus: out("policyCheck", "status"),
          PolicyIssues: out("policyCheck", "issues"),
          ApprovalOverdue: false,
        },
      }))

      // FR-07 human approval: the officer edits the structured offer and the message before approving
      .stepSwitch("retentionReview", hitl({
        title: "RADAR: review retention offer",
        priority: "High",
        fields: [
          { id: "customer", label: "Pelanggan", type: "string", direction: "input",
            value: js`$vars.eachCustomer.currentItem.customerCode + " - " + $vars.eachCustomer.currentItem.customerName + " (" + $vars.eachCustomer.currentItem.servicePlan + ", " + $vars.eachCustomer.currentItem.city + ")"` },
          { id: "churnScore", label: "Skor churn", type: "number", direction: "input", value: item("churnScore") },
          // string fields read a step output: a loop-item binding is shown literally in the task form
          { id: "riskLevel", label: "Level risiko", type: "string", direction: "input", value: out("agentContext", "level") },
          { id: "revenueAtRisk", label: "Revenue at risk (Rp/tahun)", type: "number", direction: "input", value: item("revenueAtRisk") },
          { id: "reasons", label: "Alasan", type: "string", direction: "input", value: out("agentContext", "reasons") },
          { id: "riskSummary", label: "Ringkasan AI", type: "string", direction: "input", value: out("recommend", "riskSummary") },
          { id: "recommendedAction", label: "Rekomendasi tindakan", type: "string", direction: "input", value: out("recommend", "recommendedAction") },
          { id: "aiDraft", label: "Draf penawaran AI", type: "string", direction: "input", value: out("policyCheck", "offer") },
          { id: "policyResult", label: "Cek kebijakan draf AI", type: "string", direction: "input",
            value: js`$vars.policyCheck.output.status + " - " + $vars.policyCheck.output.issues` },
          { id: "offerType", label: "Jenis penawaran (boleh diubah)", type: "singleSelect", direction: "inOut",
            options: OFFER_OPTIONS, value: out("recommend", "offerType") },
          { id: "discountPercent", label: "Diskon % (0 bila bukan diskon)", type: "number", direction: "inOut", value: out("recommend", "discountPercent") },
          { id: "offerMonths", label: "Lama penawaran (bulan)", type: "number", direction: "inOut", value: out("recommend", "durationMonths") },
          { id: "technicianVisit", label: "Tambah kunjungan teknisi prioritas", type: "boolean", direction: "inOut", value: out("recommend", "technicianVisit") },
          { id: "followUpMessage", label: "Pesan follow-up (boleh diedit)", type: "string", direction: "inOut", value: out("recommend", "followUpMessage") },
          { id: "reviewerNote", label: "Catatan reviewer", type: "string", direction: "output" },
        ],
        outcomes: ["Approve Offer", "No Action"],
      }), [
        {
          value: "Approve Offer",
          body: (b) =>
            b
              // FR-11 the version the reviewer approved is checked again: edits cannot bypass policy
              .step("recheckPolicy", script({
                code: POLICY_FN + `
                  const r = $vars.retentionReview.output;
                  const c = $vars.eachCustomer.currentItem;
                  const res = checkPolicy(r.offerType, r.discountPercent, r.offerMonths, r.technicianVisit, r.followUpMessage, c.contractMonthsLeft);
                  const emailHtml = buildCustomerEmailHtml(c.customerName, c.customerCode, c.servicePlan, c.city, res.offer, r.followUpMessage, c.overdueTicketCode, false);
                  const exceptionEmailHtml = buildCustomerEmailHtml(c.customerName, c.customerCode, c.servicePlan, c.city, res.offer, r.followUpMessage, c.overdueTicketCode, true);
                  return { status: res.status, issues: res.issues, offer: res.offer, emailHtml: emailHtml, exceptionEmailHtml: exceptionEmailHtml };
                `,
                returns: { status: "string", issues: "string", offer: "string", emailHtml: "string", exceptionEmailHtml: "string" },
              }))
              .branch(
                "offerWithinPolicy",
                js`$vars.recheckPolicy.output.status === "Compliant"`,
                (ok) =>
                  ok
                    .step("approveCase", dataFabricUpdate({
                      entity: "CsRetentionCase",
                      record: { byId: out("openCase", "Id") },
                      set: {
                        Decision: "Approved",
                        CaseStatus: "Follow-up Ready",
                        OfferDetail: out("recheckPolicy", "offer"),
                        OfferType: out("retentionReview", "offerType"),
                        DiscountPercent: out("retentionReview", "discountPercent"),
                        OfferMonths: out("retentionReview", "offerMonths"),
                        TechnicianVisit: out("retentionReview", "technicianVisit"),
                        FollowUpMessage: out("retentionReview", "followUpMessage"),
                        ReviewerNote: out("retentionReview", "reviewerNote"),
                        PolicyStatus: "Compliant",
                        PolicyIssues: "sesuai kebijakan",
                      },
                    }))
                    .branch(
                      "shouldSendFollowUp",
                      js`$vars.cfgNotifyEmail !== ""`,
                      (mail) =>
                        mail
                          .step("sendFollowUpEmail", connector(SendEmail, {
                            To: v("cfgNotifyEmail"),
                            Subject: js`"Penawaran Khusus & Tindak Lanjut Layanan - " + $vars.eachCustomer.currentItem.customerName + " (" + $vars.eachCustomer.currentItem.customerCode + ")"`,
                            Body: out("recheckPolicy", "emailHtml"),
                            SaveAsDraft: false,
                          }, { connection: "gmail", folder: "shared" }))
                          .onError((h) => h.continue())
                          .step("markFollowUpSent", dataFabricUpdate({
                            entity: "CsRetentionCase",
                            record: { byId: out("openCase", "Id") },
                            set: { CaseStatus: "Follow-up Sent" },
                          })),
                    ),
                // out of policy: a supervisor must explicitly grant an exception
                (exc) =>
                  exc.stepSwitch("supervisorReview", hitl({
                    title: "RADAR: penawaran di luar kebijakan",
                    priority: "High",
                    fields: [
                      { id: "svCustomer", label: "Pelanggan", type: "string", direction: "input",
                        value: js`$vars.eachCustomer.currentItem.customerCode + " - " + $vars.eachCustomer.currentItem.customerName` },
                      { id: "svRevenue", label: "Revenue at risk (Rp/tahun)", type: "number", direction: "input", value: item("revenueAtRisk") },
                      { id: "svOffer", label: "Penawaran yang disetujui reviewer", type: "string", direction: "input", value: out("recheckPolicy", "offer") },
                      { id: "svMessage", label: "Pesan follow-up", type: "string", direction: "input", value: out("retentionReview", "followUpMessage") },
                      { id: "svIssues", label: "Pelanggaran kebijakan", type: "string", direction: "input", value: out("recheckPolicy", "issues") },
                      { id: "svReviewerNote", label: "Catatan reviewer", type: "string", direction: "input", value: out("retentionReview", "reviewerNote") },
                      { id: "supervisorNote", label: "Alasan keputusan supervisor", type: "string", direction: "output" },
                    ],
                    outcomes: ["Approve Exception", "Reject Offer"],
                  }), [
                    {
                      value: "Approve Exception",
                      body: (s) =>
                        s
                          .step("approveException", dataFabricUpdate({
                            entity: "CsRetentionCase",
                            record: { byId: out("openCase", "Id") },
                            set: {
                              Decision: "Approved (Exception)",
                              CaseStatus: "Follow-up Ready",
                              OfferDetail: out("recheckPolicy", "offer"),
                              OfferType: out("retentionReview", "offerType"),
                              DiscountPercent: out("retentionReview", "discountPercent"),
                              OfferMonths: out("retentionReview", "offerMonths"),
                              TechnicianVisit: out("retentionReview", "technicianVisit"),
                              FollowUpMessage: out("retentionReview", "followUpMessage"),
                              ReviewerNote: js`"Reviewer: " + ($vars.retentionReview.output.reviewerNote || "-") + " | Supervisor: " + ($vars.supervisorReview.output.supervisorNote || "-")`,
                              PolicyStatus: "Exception Approved",
                              PolicyIssues: out("recheckPolicy", "issues"),
                            },
                          }))
                          .branch(
                            "shouldSendExceptionEmail",
                            js`$vars.cfgNotifyEmail !== ""`,
                            (mail) =>
                              mail
                                .step("sendExceptionEmail", connector(SendEmail, {
                                  To: v("cfgNotifyEmail"),
                                  Subject: js`"Penawaran Khusus Prioritas - " + $vars.eachCustomer.currentItem.customerName + " (" + $vars.eachCustomer.currentItem.customerCode + ")"`,
                                  Body: out("recheckPolicy", "exceptionEmailHtml"),
                                  SaveAsDraft: false,
                                }, { connection: "gmail", folder: "shared" }))
                                .onError((h) => h.continue())
                                .step("markExceptionSent", dataFabricUpdate({
                                  entity: "CsRetentionCase",
                                  record: { byId: out("openCase", "Id") },
                                  set: { CaseStatus: "Follow-up Sent" },
                                })),
                          ),
                    },
                    {
                      value: "Reject Offer",
                      body: (s) =>
                        s.step("rejectOffer", dataFabricUpdate({
                          entity: "CsRetentionCase",
                          record: { byId: out("openCase", "Id") },
                          set: {
                            Decision: "Rejected by Supervisor",
                            CaseStatus: "Closed - Offer Rejected",
                            OfferDetail: out("recheckPolicy", "offer"),
                            OfferType: out("retentionReview", "offerType"),
                            DiscountPercent: out("retentionReview", "discountPercent"),
                            OfferMonths: out("retentionReview", "offerMonths"),
                            TechnicianVisit: out("retentionReview", "technicianVisit"),
                            ReviewerNote: js`"Reviewer: " + ($vars.retentionReview.output.reviewerNote || "-") + " | Supervisor: " + ($vars.supervisorReview.output.supervisorNote || "-")`,
                            PolicyStatus: "Violation",
                            PolicyIssues: out("recheckPolicy", "issues"),
                          },
                        })),
                    },
                  ]),
              ),
        },
        {
          value: "No Action",
          body: (b) =>
            b.step("closeCase", dataFabricUpdate({
              entity: "CsRetentionCase",
              record: { byId: out("openCase", "Id") },
              set: {
                Decision: "No Action",
                CaseStatus: "Closed - No Action",
                ReviewerNote: out("retentionReview", "reviewerNote"),
              },
            })),
        },
      ]),
    { parallel: true },
  )

  // FR-10 run report, built from what was actually recorded
  .step("readRunCases", dataFabricRead({
    entity: "CsRetentionCase", resultMode: "multiple", limit: 1000,
    filters: [{ field: "RunId", value: out("newRun") }],
    sort: { field: "RevenueAtRisk", direction: "desc" },
  }))
  .step("buildReport", script({
    code: `
      const cases = $vars.readRunCases.output.results || [];
      const p = $vars.prioritize.output;
      const approved = cases.filter((c) => c.Decision === "Approved" || c.Decision === "Approved (Exception)");
      const sent = cases.filter((c) => c.CaseStatus === "Follow-up Sent");
      const exceptions = cases.filter((c) => c.Decision === "Approved (Exception)");
      const rejected = cases.filter((c) => c.Decision === "Rejected by Supervisor");
      const noAction = cases.filter((c) => c.Decision === "No Action");
      const aiFailed = cases.filter((c) => c.Decision === "AI Failed");
      const escalated = cases.filter((c) => c.TicketEscalated === true);
      const aiFlagged = cases.filter((c) => c.PolicyStatus !== "Compliant" && c.Decision !== "No Action" && c.Decision !== "AI Failed");
      // revenue of customers who will receive an approved offer; whether they stay is not tracked yet
      const offeredRevenue = approved.reduce((s, c) => s + Number(c.RevenueAtRisk || 0), 0);
      const rp = (n) => "Rp " + String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".");
      const summary = "RADAR " + $vars.newRun.output + ": " + p.scoredCount + " pelanggan dinilai (" +
        $vars.scoringUsed + ", keluhan dibaca " + ($vars.complaintMode === "ai" ? "AI" : "kata kunci") + "), " +
        p.highRiskCount + " berisiko tinggi dengan revenue at risk " + rp(p.highRiskRevenue) +
        "/tahun. " + cases.length + " kasus baru diproses: " + escalated.length + " tiket dieskalasi, " + approved.length +
        " penawaran disetujui (" + rp(offeredRevenue) + "/tahun ditawari retensi" +
        (sent.length ? ", " + sent.length + " email terkirim" : "") +
        (exceptions.length ? ", " + exceptions.length + " lewat pengecualian supervisor" : "") + "), " +
        (rejected.length ? rejected.length + " ditolak supervisor, " : "") +
        (aiFailed.length ? aiFailed.length + " perlu ditangani manual karena AI gagal, " : "") + noAction.length + " tanpa tindakan." +
        (p.hiddenIntent.length ? " Peringatan dini: " + p.hiddenIntent.length + " pelanggan berskor rendah menyebut niat berhenti di keluhannya." : "") +
        (p.skipped.length ? " " + p.skipped.length + " pelanggan berisiko dilewati karena sudah punya kasus atau masih masa jeda kontak." : "") +
        (p.overdue.length ? " " + p.overdue.length + " approval lewat SLA " + $vars.cfgSlaHours + " jam ditandai untuk supervisor." : "") +
        ($vars.scoringNote ? " Catatan: " + $vars.scoringNote + "." : "") +
        ($vars.complaintMode !== "ai" && $vars.complaintNote ? " Catatan: " + $vars.complaintNote + "." : "");
      const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const caseRows = cases.map((c) =>
        "<tr>" +
        "<td style='padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;font-weight:600;'>" + esc(c.CustomerCode + " " + c.CustomerName) + "</td>" +
        "<td style='padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;'>" + esc(c.ChurnScore) + " (" + esc(c.RiskLevel) + ")</td>" +
        "<td style='padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;'>" + esc(c.OfferDetail || "-") + "</td>" +
        "<td style='padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#0062cc;'>" + esc(c.CaseStatus) + "</td>" +
        "</tr>"
      ).join("");
      const ewHtml = p.hiddenIntent.length
        ? "<div style='margin-top:20px;padding:12px 14px;background:#f8fafc;border-left:3px solid #0062cc;font-size:12.5px;color:#334155;'>"
          + "<div style='font-weight:700;color:#0e1721;margin-bottom:6px;'>Peringatan Dini (" + p.hiddenIntent.length + " pelanggan skor rendah)</div>"
          + p.hiddenIntent.map((x) => "<div style='margin-bottom:3px;'>&bull; <strong>" + esc(x.customer) + "</strong> (skor " + x.churnScore + "): &ldquo;" + esc(x.complaint) + "&rdquo;</div>").join("")
          + "</div>"
        : "";
      const reportHtml = "<div style='margin:0;padding:20px 12px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;'>"
        + "<div style='max-width:640px;margin:0 auto;'>"
        + "<div style='border-bottom:2px solid #0e1721;padding-bottom:10px;margin-bottom:18px;'>"
        + "<div style='font-size:16px;font-weight:700;color:#0e1721;'>RADAR &mdash; Laporan Run Harian</div>"
        + "<div style='font-size:12px;color:#64748b;margin-top:2px;'>Run ID: " + esc($vars.newRun.output) + " &middot; Scoring: " + esc($vars.scoringUsed) + " &middot; Analisis Keluhan: " + ($vars.complaintMode === "ai" ? "AI" : "Kata Kunci") + "</div>"
        + "</div>"
        + "<table width='100%' cellspacing='0' cellpadding='0' style='margin-bottom:16px;border-collapse:collapse;'><tr>"
        + "<td style='padding:10px 12px;border:1px solid #e5e7eb;'><div style='font-size:11px;color:#64748b;'>Dinilai</div><div style='font-size:18px;font-weight:700;color:#0e1721;'>" + p.scoredCount + "</div></td>"
        + "<td style='padding:10px 12px;border:1px solid #e5e7eb;'><div style='font-size:11px;color:#64748b;'>Risiko Tinggi</div><div style='font-size:18px;font-weight:700;color:#0e1721;'>" + p.highRiskCount + "</div></td>"
        + "<td style='padding:10px 12px;border:1px solid #e5e7eb;'><div style='font-size:11px;color:#64748b;'>Tiket Dieskalasi</div><div style='font-size:18px;font-weight:700;color:#0062cc;'>" + escalated.length + "</div></td>"
        + "<td style='padding:10px 12px;border:1px solid #e5e7eb;'><div style='font-size:11px;color:#64748b;'>Email Terkirim</div><div style='font-size:18px;font-weight:700;color:#0062cc;'>" + sent.length + " / " + approved.length + "</div></td>"
        + "</tr></table>"
        + "<p style='margin:0 0 18px 0;font-size:13.5px;line-height:1.6;color:#374151;'>" + esc(summary) + "</p>"
        + "<table width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;border-top:1px solid #cbd5e1;'>"
        + "<tr><th align='left' style='padding:8px 10px;border-bottom:1px solid #cbd5e1;font-size:11px;color:#475569;text-transform:uppercase;'>Pelanggan</th><th align='left' style='padding:8px 10px;border-bottom:1px solid #cbd5e1;font-size:11px;color:#475569;text-transform:uppercase;'>Skor</th><th align='left' style='padding:8px 10px;border-bottom:1px solid #cbd5e1;font-size:11px;color:#475569;text-transform:uppercase;'>Penawaran</th><th align='left' style='padding:8px 10px;border-bottom:1px solid #cbd5e1;font-size:11px;color:#475569;text-transform:uppercase;'>Status</th></tr>"
        + (caseRows || "<tr><td colspan='4' style='padding:10px;font-size:13px;color:#64748b;'>Tidak ada kasus baru pada run ini.</td></tr>")
        + "</table>"
        + ewHtml
        + "<div style='margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8;'>Angka revenue menunjukkan pelanggan yang ditawari retensi; hasil aktual dilacak terpisah setelah integrasi billing. &middot; RADAR</div>"
        + "</div></div>";
      return {
        summary: summary,
        reportHtml: reportHtml,
        report: {
          runId: $vars.newRun.output, scoringMode: $vars.scoringUsed, scoringNote: $vars.scoringNote,
          complaintAnalysis: $vars.complaintMode, complaintNote: $vars.complaintNote,
          customersScored: p.scoredCount, openTickets: $vars.buildFeatures.output.openTicketCount,
          highRiskCount: p.highRiskCount, revenueAtRisk: p.highRiskRevenue,
          casesProcessed: cases.length, ticketsEscalated: escalated.length,
          offersApproved: approved.length, emailsSent: sent.length, policyExceptions: exceptions.length, rejectedBySupervisor: rejected.length,
          noAction: noAction.length, aiFailedManualReview: aiFailed.length,
          revenueOfferedRetention: offeredRevenue,
          revenueNote: "revenue pelanggan yang ditawari retensi; pelanggan bertahan atau tidak belum dilacak",
          policyNotCompliantAtClose: aiFlagged.length,
          earlyWarningIntent: p.hiddenIntent, skippedExistingCase: p.skipped, approvalsOverdue: p.overdue,
          cases: cases.map((c) => ({
            customer: c.CustomerCode + " " + c.CustomerName, churnScore: c.ChurnScore, riskLevel: c.RiskLevel,
            revenueAtRisk: c.RevenueAtRisk, ticketEscalated: c.TicketEscalated, decision: c.Decision,
            status: c.CaseStatus, offer: c.OfferDetail, policy: c.PolicyStatus, policyIssues: c.PolicyIssues
          }))
        }
      };
    `,
    returns: { summary: "string", reportHtml: "string", report: "object" },
  }))
  .branch(
    "shouldSendReport",
    js`$vars.cfgNotifyEmail !== ""`,
    (mail) =>
      mail
        .step("sendRunReportEmail", connector(SendEmail, {
          To: v("cfgNotifyEmail"),
          Subject: js`"[RADAR] Laporan Eksekutif Run " + $vars.newRun.output`,
          Body: out("buildReport", "reportHtml"),
          SaveAsDraft: false,
        }, { connection: "gmail", folder: "shared" }))
        .onError((h) => h.stepToRef("finalReturn")),
  )
  .step("finalReturn", script({ code: `return true;`, returns: "boolean" }))
  .return({
    runId: out("newRun"),
    scoringModeUsed: v("scoringUsed"),
    summary: out("buildReport", "summary"),
    customersScored: out("prioritize", "scoredCount"),
    highRiskCount: out("prioritize", "highRiskCount"),
    revenueAtRisk: out("prioritize", "highRiskRevenue"),
    report: out("buildReport", "report"),
  })
  .build();
