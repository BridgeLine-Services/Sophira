# Legal Configuration — Owner-Supplied Information

**Status: INCOMPLETE — owner input required before production publication.**

This document lists every piece of legal information the repository owner must
supply before the LICENSE, Terms of Service, and Privacy Policy are suitable
for production publication. No values have been invented, and none should be:
each field must come from the owner (or the owner's attorney).

These documents are templates prepared at the owner's direction. Neither the
AI that prepared them nor Base44 is the owner's lawyer, and nothing here is
legal advice. Attorney review is strongly recommended before production
publication (see `LEGAL_REVIEW_NOTICE.md`).

---

## A. Entity identity

| # | Field | Placeholder(s) | Appears in |
|---|-------|-----------------|------------|
| A1 | **Legal entity / copyright holder name** — the exact legal name of the person or entity that owns and operates Sophira (e.g., an individual's legal name or a registered company name as it appears in official records) | `[LEGAL ENTITY NAME]`, `[COPYRIGHT HOLDER LEGAL NAME]` | LICENSE (header, NOTE), TERMS_OF_SERVICE.md (§ header, §18, §35), PRIVACY_POLICY.md (header) |
| A2 | **Registered business / mailing address** | `[ADDRESS]` | TERMS_OF_SERVICE.md (§ header, §35), PRIVACY_POLICY.md (header) |
| A3 | **Contact email for legal, privacy, and support matters** | `[CONTACT EMAIL]` | TERMS_OF_SERVICE.md (§ header, §24 data requests, §35), PRIVACY_POLICY.md (§ header, retention/deletion, security incidents, user rights) |
| A4 | **Legal contact name** (if different from A1, e.g., "Attn: Legal" or an attorney/agent) | `[LEGAL CONTACT NAME / EMAIL / ADDRESS]` | LICENSE (Contact line) |

## B. Dates

| # | Field | Placeholder(s) | Appears in |
|---|-------|-----------------|------------|
| B1 | **Effective date** of the Terms of Service and Privacy Policy (the date the documents take effect for users) | `[EFFECTIVE DATE]` | TERMS_OF_SERVICE.md (header), PRIVACY_POLICY.md (header) |
| B2 | **Copyright year / first publication year** for the LICENSE notice | `[EFFECTIVE DATE YEAR]` | LICENSE (Copyright line, NOTE) |

## C. Jurisdiction and governing law

| # | Field | Placeholder(s) | Appears in |
|---|-------|-----------------|------------|
| C1 | **Governing-law jurisdiction** — the state/country whose substantive law governs the LICENSE, Terms, and Privacy Policy, and where the operator expects enforcement | `[JURISDICTION]` | LICENSE (§7, NOTE), TERMS_OF_SERVICE.md (§30), PRIVACY_POLICY.md (notice, user rights) |

## D. Liability and disputes

| # | Field | Placeholder(s) | Appears in |
|---|-------|-----------------|------------|
| D1 | **Limitation-of-liability amount** (or confirmation that the cap should be expressed only by reference to the maximum permitted by applicable law) | `[MAXIMUM LIABILITY AMOUNT / AS REQUIRED BY APPLICABLE LAW]` | TERMS_OF_SERVICE.md (§28) |
| D2 | **Dispute-resolution method** — e.g., binding arbitration, mediation-then-courts, or the courts of the chosen jurisdiction | `[DISPUTE RESOLUTION METHOD: e.g., binding arbitration / courts of JURISDICTION]` | TERMS_OF_SERVICE.md (§31) |
| D3 | **Applicable rules / forum** for the chosen method (e.g., arbitration institution and rules, or court venue) | `[APPLICABLE RULES]` | TERMS_OF_SERVICE.md (§31) |

## E. Data retention

| # | Field | Placeholder(s) | Appears in |
|---|-------|-----------------|------------|
| E1 | **Retention period after a deletion request** (subject to legal/backup retention) | `[RETENTION PERIOD]` | PRIVACY_POLICY.md (Storage, retention, deletion) |

## F. Attorney review (recommended, not placeholder text)

| # | Field | Notes |
|---|-------|-------|
| F1 | **Reviewing attorney or firm** | Not inserted into any document. The owner should engage a qualified attorney in jurisdiction C1 to review the final documents BEFORE production publication. See `LEGAL_REVIEW_NOTICE.md`. |

---

## Publication gate

Do **not** publish or operate the service for real users until:

1. Every field in sections A–E above has a real, owner-supplied value.
2. Every listed placeholder has been replaced in LICENSE, TERMS_OF_SERVICE.md,
   and PRIVACY_POLICY.md (search for `[` to confirm none remain — aside from
   intentional Markdown brackets in code contexts).
3. A qualified attorney in the governing-law jurisdiction has reviewed the
   final documents.

## What the documents already cover (subject to the placeholders above)

Copyright ownership; proprietary-software status; restrictions on
unauthorized copying, redistribution, modification, sublicensing, and
commercial exploitation; source-code confidentiality; IP enforcement with
cautious language (unauthorized use *may* constitute infringement or breach;
the owner reserves all rights and remedies available under applicable law);
account suspension/termination; acceptable use; privacy and data processing
including user academic data; user security responsibilities; third-party
services and AI providers; disclaimers; limitation of liability; dispute
resolution; governing law; effective date; and contact information.

**The documents carry no guarantee of legal enforceability and have not been
approved or reviewed by any attorney; they must not be described as such.**
