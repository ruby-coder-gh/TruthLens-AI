# Demo script — 3 minutes

Setup: `./run.sh --demo`, then open the frontend when it launches. Everything below
runs against the seeded **Northwind Renewables — Due Diligence** workspace (a fictional
wind + solar developer), so nothing here depends on documents you'd have to upload live.

## 0. Land (10s)

- Landing page → **Try the live demo**.
- Login page → click **Analyst** (one-click, no password to type).

## 1. Ask a question (30s)

- Open the seeded workspace, click one of the **suggested questions** — e.g.
  *"What was Northwind Renewables' revenue in 2025?"*
- Narrate while it streams: fully local generation (Ollama, qwen3:4b-instruct), no API keys,
  no cloud calls.

## 2. Truth Lens (40s)

- Toggle **Truth Lens** on the answer. Every claim in the answer is colored by how well
  the retrieved documents support it: supported / partial / unsupported / contradicted.
- Hover a claim → evidence card shows the exact source sentence and a trust chip.
- Point out the claim ledger summary (✅/⚠️/❌ counts) — this is the receipt, at a glance,
  of how grounded the whole answer is.

## 3. View in document (30s)

- Click **View in document** on a cited source. The source viewer opens the actual PDF,
  scrolls to the right page, and highlights the exact passage the model cited —
  not just "trust us," the literal sentence.

## 4. Seal a Truth Receipt (30s)

- Click **Seal receipt** → shows the public-exposure warning, then the link + QR code.
- Open the link in a private/incognito window (logged out): the receipt renders
  standalone — claims, evidence, trust gauge, and a seal the browser re-verifies itself
  (WebCrypto hash match), plus the server's signature status. Print → Save as PDF works too.

## 5. Contradiction Radar (40s)

- Switch to the workspace's **Radar** tab. The seeded corpus has planted, real-world-style
  conflicts across documents: revenue (€412M vs €398M), emissions intensity (−34% vs
  −41%), Aurora's commissioning date (Q3 2027 vs Q1 2028), and the CEO's start date
  (March 2021 vs January 2022).
- Open a conflict card, show both sides side by side, then **View in document** on either
  side to land on the exact conflicting sentence in its source.

## 6. Admin analytics (20s)

- Log out, one-click **Admin** login.
- Usage & Cost report: local Ollama usage shows $0 cost; note the abstained-query rows are
  correctly excluded from the model breakdown (they never called the LLM).

## Wrap

"Every one of those four claims — Truth Lens verdict, cited passage, sealed receipt, and
flagged contradiction — is generated from what's actually in the documents, entirely on
this laptop, with nothing sent to a cloud API."
