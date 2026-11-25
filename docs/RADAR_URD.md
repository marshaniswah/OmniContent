# USER REQUIREMENTS DOCUMENT (URD)
## RADAR
**Human-in-the-Lead Churn Prevention Automation for Fixed Broadband Providers**

| Document Information | Details |
|---|---|
| Product Name | RADAR |
| Document Type | User Requirements Document (URD) |
| Version | 1.0 |
| Status | Initial Draft |
| Primary User | Retention Officer |
| Secondary Users | NOC Engineer, Customer Experience / Retention Manager |
| Supporting User | Automation / Data Administrator |

---

## 1. Introduction

### 1.1 Purpose

This document defines what the users of RADAR need: their roles, the behavior they expect, usage scenarios, and acceptance criteria. It complements the RADAR PRD.

### 1.2 Intended Audience

- Product owners.
- Automation developers.
- Retention and customer care stakeholders.
- Network operations stakeholders.
- Testers.
- Hackathon reviewers.

### 1.3 Product Scope from the User Perspective

Users should be able to:
- See which customers are most likely to leave, and why.
- See how much recurring revenue is at risk.
- Rely on overdue network tickets of at-risk customers being escalated.
- Review, edit and approve retention offers and messages.
- Track the status of every retention case.
- Read a summary of each run.
- Connect their own churn model, if they have one.

---

## 2. User Profiles

### 2.1 User 1: Retention Officer

**Description:** Handles customer retention and decides which customers receive offers.

**Goals:**
- Work on the customers that matter most first.
- Understand the reasons behind each risk score.
- Contact customers with a relevant, approved offer.

**Challenges:**
- Signals are spread across network, ticket and billing systems.
- No consistent rule for who gets an offer.
- Too many customers to review manually.

**Expected Benefits:** A short daily priority list, ready-made recommendations, and a clear approval record.

### 2.2 User 2: NOC Engineer

**Description:** Resolves network trouble tickets.

**Goals:**
- Know which overdue tickets threaten valuable customers.
- Receive escalations with business context.

### 2.3 User 3: Customer Experience / Retention Manager

**Description:** Owns churn and revenue retention targets.

**Goals:**
- See revenue at risk and actions taken per run.
- Ensure offers follow a consistent policy and are approved.

### 2.4 User 4: Automation / Data Administrator

**Description:** Maintains data sources, scheduling and the scoring configuration.

**Goals:**
- Configure thresholds and the number of customers per run.
- Plug in an external churn model through a defined contract.
- Monitor failures and fallbacks.

---

## 3. User Needs

| ID | User Need | Priority |
|---|---|---|
| UN-01 | Users need customer, network and ticket data combined automatically. | High |
| UN-02 | Users need a churn risk score with understandable reasons. | High |
| UN-03 | Users need customers prioritized by risk and revenue at risk. | High |
| UN-04 | Users need overdue tickets of at-risk customers escalated automatically. | High |
| UN-05 | Users need a recommended retention action, offer and message. | High |
| UN-06 | Users need to approve, edit or decline each retention action. | High |
| UN-07 | Users need the status of each retention case. | High |
| UN-08 | Users need a summary report per run. | High |
| UN-09 | Users need to plug in their own churn model. | Medium |
| UN-10 | Users need notifications for escalations, follow-ups and reports. | Medium |
| UN-11 | Users need the automation to keep working if the external model fails. | High |

---

## 4. User Roles and Permissions

| Function | Retention Officer | NOC Engineer | Retention Manager | Administrator |
|---|---|---|---|---|
| View prioritized customers | Yes | Limited | Yes | Yes |
| View risk reasons | Yes | Yes | Yes | Yes |
| Approve / edit / decline offers | Yes | No | Optional | No |
| Receive ticket escalations | No | Yes | Optional | No |
| View run reports | Yes | Yes | Yes | Yes |
| Configure thresholds and scoring mode | No | No | Optional | Yes |
| Configure external model and connections | No | No | No | Yes |

The retention officer is the decision-maker for customer contact and offers.

---

## 5. User Requirements and Expected Behavior

### UR-01: Combine Customer, Network and Ticket Data

**User Requirement:** As a retention officer, I want the system to combine customer, network quality and ticket data so that I do not need to check several systems.

**Expected System Behavior:**
1. The system reads customer records and open tickets at the start of each run.
2. The system calculates open and overdue tickets per customer.
3. The system calculates annual revenue at risk per customer.

**Acceptance Criteria:**
- Every customer is evaluated in each run.
- Overdue tickets are identified using each ticket's SLA.
- A data source failure is visible and stops the run without contacting customers.

### UR-02: Understand Churn Risk

**User Requirement:** As a retention officer, I want a churn risk score with reasons so that I can trust and explain the priority.

**Expected System Behavior:**
1. The system scores each customer from 0 to 1.
2. The system lists the top reasons for the score.
3. The system shows whether rules or an external model produced the score.
4. An AI agent reads the complaint text and the reasons say when a complaint is negative or shows intent to leave.

**Acceptance Criteria:**
- Each prioritized customer has a score, risk level and reasons.
- The scoring mode is recorded per case.
- Slang and implied intent ("mending cabut aja", "provider sebelah") are recognised; a neutral question is not counted as negative.
- If the AI is unavailable, the keyword list is used and the report says so.

### UR-03: Prioritize by Risk and Revenue

**User Requirement:** As a retention manager, I want customers ranked by risk and revenue at risk so that the team focuses on the most valuable customers first.

**Expected System Behavior:**
1. The system keeps customers at or above the risk threshold.
2. The system ranks them by risk × revenue at risk.
3. The system keeps the top N per run.

**Acceptance Criteria:**
- The threshold and N are configurable.
- Revenue at risk is shown per customer and in total.

### UR-04: Escalate Overdue Network Tickets

**User Requirement:** As a NOC engineer, I want overdue tickets of at-risk customers escalated automatically so that I fix the issues that threaten revenue first.

**Expected System Behavior:**
1. The system finds the most overdue open ticket of each prioritized customer.
2. The system marks it as escalated with a note explaining the customer's value and risk.
3. The retention case records that a ticket was escalated.

**Acceptance Criteria:**
- Only overdue tickets are escalated.
- Each escalation has a note with risk score, revenue at risk and hours overdue.

### UR-05: Receive a Retention Recommendation

**User Requirement:** As a retention officer, I want a recommended action, offer and follow-up message so that I can act quickly and consistently.

**Expected System Behavior:**
1. The AI agent summarizes the risk.
2. The AI agent proposes an action and a structured offer within policy (type, percent, months, technician visit).
3. The AI agent drafts a follow-up message in Bahasa Indonesia that acknowledges the service issue and states the same offer.

**Acceptance Criteria:**
- Recommendations use only the customer's data.
- Messages do not promise outcomes that cannot be guaranteed.
- If the AI fails for one customer, that case is marked `Needs Manual Review` with the error and the other customers are still processed.

### UR-06: Approve, Edit or Decline

**User Requirement:** As a retention officer, I want to approve, edit or decline each retention action so that I stay in control of what customers receive.

**Expected System Behavior:**
1. The system creates an approval task per prioritized customer.
2. The task shows the customer context, score, reasons, revenue at risk, ticket status and recommendation.
3. The officer can change the offer type (dropdown), percent, months, technician visit and message, add a note, and approve or choose no action.
4. The system records the decision.

**Acceptance Criteria:**
- No follow-up is prepared or sent without approval.
- Edited offer and message are the versions stored.
- No-action decisions close the case without contact.

### UR-07: Track Retention Cases

**User Requirement:** As a retention manager, I want to see the status of each case so that I know what is pending and what is done.

**Expected System Behavior:** Each case moves through Analyzing, Pending Approval, Follow-up Ready, Follow-up Sent, Closed - No Action, Closed - Offer Rejected, or Needs Manual Review.

**Acceptance Criteria:**
- Each case has a visible status.
- Decisions and reviewer notes are stored with the case.

### UR-08: Read the Run Report

**User Requirement:** As a retention manager, I want a report after each run so that I can see the impact.

**Expected System Behavior:** The system reports customers scored, high-risk customers, total revenue at risk, tickets escalated, approvals, revenue offered retention, no-action decisions, manual-review cases, and early-warning customers (low score, but the complaint shows intent to leave).

**Acceptance Criteria:**
- The report matches the recorded cases for that run.
- The report states the scoring mode and complaint analysis mode used and any fallback.
- Revenue of approved offers is labelled as offered retention, not as revenue saved.

### UR-09: Use Our Own Churn Model

**User Requirement:** As an administrator, I want to connect our own churn model so that RADAR uses our best prediction.

**Expected System Behavior:**
1. The administrator sets the scoring mode to external and provides the model URL.
2. The system sends customer features in the documented format.
3. The system uses returned scores; on failure it falls back to rules.

**Acceptance Criteria:**
- Switching mode does not require changing the workflow.
- A model failure does not stop the run and is reported.

### UR-10: Receive Notifications

**User Requirement:** As a user, I want email notifications for escalations, approved follow-ups and run reports.

**Acceptance Criteria:**
- Notifications are sent only when an email connection is configured.
- Without a connection, the system shows that delivery is pending and does not claim it was sent.

### UR-11: Keep Offers Within Policy

**User Requirement:** As a retention manager, I want every offer checked against our retention policy, so that neither the AI nor an officer can give away more than allowed without a supervisor's decision.

**Expected System Behavior:** The AI draft is checked and the result is shown in the approval task. The version the officer approves is checked again. An out-of-policy offer creates a supervisor task listing the violations.

**Acceptance Criteria:**
- An offer above 30%, longer than 3 months, combining offer types, or with an unjustified free month is flagged.
- A message that promises more than the offer fields (another percentage, a percentage in words, "setengah harga", another duration, a free month with a discount) is flagged.
- Promises such as "dijamin" or "bebas gangguan" are flagged.
- An out-of-policy offer reaches Follow-up Ready only after the supervisor approves an exception, with the reason recorded.
- A rejected offer closes the case as `Closed - Offer Rejected`.

### UR-12: No Duplicate Cases or Repeated Contact

**User Requirement:** As a retention officer, I do not want a second task for a customer I am already handling, and I do not want to contact the same customer again too soon.

**Acceptance Criteria:**
- A customer with an open case gets no new case, even when runs overlap.
- A customer contacted within the cooldown (30 days) is skipped.
- A customer whose offer was rejected by the supervisor can get a new, compliant offer in the next run.
- The report lists every skipped customer with the reason.

### UR-13: Approvals Do Not Wait Unnoticed

**User Requirement:** As a retention manager, I want to see approvals that have waited too long.

**Acceptance Criteria:**
- Cases waiting longer than the approval SLA (24 hours) are flagged `ApprovalOverdue`.
- Flagged cases appear in the next run report.

---

## 6. User Journey

**Step 1 — Run starts.** The daily schedule (or a manual run) starts RADAR.

**Step 2 — Data combined.** Customer and ticket data are read and combined.

**Step 3 — Risk scored.** Each customer gets a churn score and reasons.

**Step 4 — Priorities set.** Customers above the threshold are ranked by risk and revenue at risk.

**Step 5 — Tickets escalated.** Overdue tickets of prioritized customers are escalated to the NOC.

**Step 6 — Recommendations prepared.** The AI agent drafts the action, a structured offer and the message.

**Step 7 — Officer decides.** The retention officer sees the policy check, edits and approves, or chooses no action.

**Step 7a — Supervisor (only when needed).** If the approved offer is out of policy, the supervisor approves an exception or rejects it.

**Step 8 — Follow-up.** Approved follow-ups are prepared or sent.

**Step 9 — Report.** The manager reviews the run report and the case list.

---

## 7. User Stories Summary

| ID | User Story | Priority |
|---|---|---|
| US-01 | As a retention officer, I want combined customer, network and ticket data. | Must Have |
| US-02 | As a retention officer, I want a churn score with reasons. | Must Have |
| US-03 | As a retention manager, I want customers prioritized by revenue at risk. | Must Have |
| US-04 | As a NOC engineer, I want overdue tickets of at-risk customers escalated. | Must Have |
| US-05 | As a retention officer, I want an AI recommendation, offer and message. | Must Have |
| US-06 | As a retention officer, I want to approve, edit or decline actions. | Must Have |
| US-07 | As a retention manager, I want to track case status. | Must Have |
| US-08 | As a retention manager, I want a run report. | Must Have |
| US-09 | As an administrator, I want to plug in our own churn model. | Should Have |
| US-10 | As a user, I want email notifications. | Should Have |
| US-11 | As a retention manager, I want offers kept within policy, with supervisor exceptions. | Must Have |
| US-12 | As a retention officer, I want no duplicate cases and no repeated contact. | Must Have |
| US-13 | As a retention manager, I want overdue approvals flagged. | Should Have |

---

## 8. User Interface Requirements

| Interface | Description |
|---|---|
| Approval task (Action Center) | Customer context, churn score, reasons, revenue at risk, ticket status, recommendation, AI draft and its policy check, editable offer type (dropdown) / percent / months / technician visit and message, reviewer note, Approve / No Action |
| Supervisor task (Action Center) | Customer, revenue at risk, approved offer, message, policy violations, reviewer note, supervisor reason, Approve Exception / Reject Offer |
| Retention cases (Data Fabric) | List of cases per run with status, decision and notes |
| Tickets (Data Fabric) | Open and escalated tickets with escalation notes |
| Run report | Run output and, when email is configured, a summary email |
| Configuration | Run inputs: threshold, top N, scoring mode, external model URL, contact cooldown, approval SLA |

### Usability Requirements

- Reasons must be written in plain language.
- The approval task must fit the decision on one screen.
- Editable fields must be pre-filled with the AI draft.
- Statuses must be clearly distinguishable.

---

## 9. User-Level Business Rules

1. Every customer is scored in each run.
2. Only customers at or above the threshold are prioritized.
3. Priority is risk × annual revenue at risk.
4. Only overdue tickets are escalated, and only for prioritized customers.
5. No customer is contacted without approval.
6. Offers must stay within policy; an out-of-policy offer needs a supervisor's recorded exception.
7. Every decision is recorded with its reviewer note.
8. A follow-up is reported as sent only after delivery succeeds.
9. External model failure falls back to rules and is reported.
10. The prototype uses synthetic data only.
11. One open case per customer; no new contact within the cooldown.

---

## 10. User Acceptance Testing (UAT)

| Test ID | Scenario | Expected Result |
|---|---|---|
| UAT-01 | Run with default settings | Customers scored; top N high-risk customers listed |
| UAT-02 | Customer with overdue ticket is prioritized | Ticket escalated with note; case flags escalation |
| UAT-03 | Customer without overdue ticket is prioritized | No ticket escalated |
| UAT-04 | Approval task opened | Context, score, reasons and editable recommendation are shown |
| UAT-05 | Officer edits and approves | Edited offer and message stored; status Follow-up Ready or Sent |
| UAT-06 | Officer chooses no action | Case closed; no follow-up |
| UAT-07 | Threshold set very high | Run completes with no cases and reports it |
| UAT-08 | External mode with failing model URL | Fallback to rules recorded; run completes |
| UAT-09 | Email connection not configured | Status stays Follow-up Ready; no false "sent" claim |
| UAT-10 | Run report reviewed | Totals match recorded cases |
| UAT-11 | Officer edits the offer to 50% for 6 months and approves | Supervisor task lists the violations; Approve Exception stores `Approved (Exception)` with both notes |
| UAT-12 | Supervisor rejects an out-of-policy offer | Case `Closed - Offer Rejected`; customer eligible again in the next run |
| UAT-13 | Second run while the first run's tasks are still open | Those customers skipped with reason; no duplicate case |
| UAT-14 | Approval waits past the SLA | Case flagged `ApprovalOverdue` and listed in the report |
| UAT-15 | Complaint "mending cabut aja kalau gini terus" | Reason shows AI intent to leave; neutral "Internet lagi bagus kok, cuma mau tanya ..." is not negative |
| UAT-16 | Low-score customer asks how to cancel | Listed as early warning in the report |
| UAT-17 | Officer switches to a discount but keeps a message promising a free month | Re-check flags the message; supervisor task |
| UAT-18 | AI model unavailable | Keyword fallback noted; case `Needs Manual Review`; run completes |

---

## 11. Expected User Benefits

- At-risk customers identified daily instead of at termination.
- Effort focused on the customers with the highest revenue at risk.
- Network issues that threaten revenue escalated automatically.
- Consistent, approved retention offers.
- A complete audit trail of retention decisions.
- Freedom to use the provider's own churn model.

**Expected Outcome:** RADAR helps broadband providers intervene earlier, resolve service issues faster for valuable customers, and protect recurring revenue, with people making every retention decision.
