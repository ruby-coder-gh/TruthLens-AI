"""Truth Lens verdict eval against the REAL NLI model (opt-in: EVAL_RUN=1).

Golden set: four realistic ~2k-char chunks (the size ingestion produces) and 24
labelled claims. Guards the premise strategy and verdict thresholds in
`guardrail.py`: full-chunk-only premises scored 1/12 supported claims as
"supported"; chunk + best window + numeric guard scores 7/12 with no claim
wrongly marked supported or contradicted.
"""

from __future__ import annotations

import os
import time

import pytest

CHUNKS = [
    "Northwind Renewables Annual Report 2025 - Financial Review. "
    "Northwind Renewables reported total revenue of $48.2 million for fiscal 2025, up 12% from "
    "$43.0 million in fiscal 2024. The increase was driven primarily by the first full year of "
    "output from the Harbor Point wind farm and higher merchant power prices in the second half. "
    "Operating expenses rose 7% to $39.1 million, reflecting additional maintenance crews and "
    "higher insurance premiums following the 2024 storm season. Operating margin improved to 9.5% "
    "from 6.8% a year earlier. Net income was $3.1 million, compared with a net loss of $0.4 million "
    "in 2024. Capital expenditure totalled $22.6 million, of which $18.0 million related to the "
    "Cedar Ridge solar project. The company ended the year with cash and equivalents of $11.7 million "
    "and total debt of $64.0 million. The board has proposed no dividend for 2025 and intends to "
    "reinvest free cash flow into the development pipeline. Headcount grew to 312 employees at "
    "year end, from 268 at the end of 2024. Management expects revenue growth in 2026 to be in the "
    "range of 8% to 10%, assuming average wind resource and no major curtailment events.",
    "Operations Update - Q4 2025. The Harbor Point wind farm reached commercial operation in March "
    "2025 with an installed capacity of 40 MW across 12 turbines. Availability averaged 96.1% over "
    "the first six months, slightly below the 97% contractual target because of a gearbox "
    "replacement on turbine 7 in August. Net capacity factor for the year was 34%. The Cedar Ridge "
    "solar project (25 MW) is under construction and is expected to reach commercial operation in "
    "the second quarter of 2026. Construction is 70% complete and the project remains within its "
    "$31 million budget. The Lakeview battery storage pilot, a 5 MW / 10 MWh system, completed "
    "commissioning in November 2025 and is providing frequency response services to the grid "
    "operator. There were no lost-time injuries across the fleet in 2025. The operations team "
    "completed 1,240 scheduled maintenance tasks and responded to 86 unplanned outages, with a "
    "median response time of 3.5 hours.",
    "Employee Handbook - Leave Policy (effective 1 January 2025). Full-time employees accrue 20 days "
    "of paid annual leave per calendar year, pro-rated for part-time staff. Up to 5 unused days may "
    "be carried over into the following year; any additional unused leave is forfeited on 31 March. "
    "Parental leave is 16 weeks at full pay for the primary caregiver and 4 weeks at full pay for the "
    "secondary caregiver, available to employees with at least six months of continuous service. "
    "Sick leave is uncapped but absences longer than three consecutive working days require a medical "
    "certificate. Requests for annual leave must be submitted through the HR portal at least two "
    "weeks in advance and approved by the employee's line manager. Employees working at operational "
    "sites must additionally coordinate leave with the site rota to maintain minimum staffing.",
    "Sustainability Report 2025. Northwind's operating assets generated 131 GWh of renewable "
    "electricity in 2025, avoiding an estimated 58,000 tonnes of CO2 emissions compared with the "
    "regional grid average. Scope 1 and 2 emissions from company operations were 1,420 tonnes of "
    "CO2e, a 9% reduction from 2024, mainly due to the electrification of the service vehicle fleet. "
    "The company committed to reaching net zero operational emissions by 2030. A biodiversity survey "
    "at Harbor Point recorded no significant impact on local bird populations.",
]

SUPPORTED = [
    "Northwind's revenue for fiscal 2025 was $48.2 million, up 12% from the prior year.",
    "Operating margin improved to 9.5% in 2025.",
    "The company employed 312 people at the end of 2025.",
    "Net income was $3.1 million in 2025.",
    "Harbor Point has an installed capacity of 40 MW.",
    "The Cedar Ridge solar project is expected to start commercial operation in Q2 2026.",
    "Primary caregivers receive 16 weeks of parental leave at full pay.",
    "Employees can carry over up to five unused leave days.",
    "Operational assets generated 131 GWh of renewable electricity in 2025.",
    "Northwind aims to reach net zero operational emissions by 2030.",
    "Sales grew by twelve percent in 2025 thanks to the new wind farm.",
    "Nobody suffered a lost-time injury in 2025.",
]
CONTRADICTED = [
    "Northwind's revenue for fiscal 2025 was $52 million.",
    "Operating margin fell to 6.8% in 2025.",
    "Harbor Point has an installed capacity of 25 MW.",
    "Full-time employees accrue 30 days of paid annual leave per year.",
    "The company reported a net loss in 2025.",
    "Parental leave for the primary caregiver is 8 weeks.",
    "Scope 1 and 2 emissions increased in 2025.",
]
UNSUPPORTED = [
    "Northwind plans to open an office in Tokyo next year.",
    "The CEO attributes the growth to strong demand from data centres.",
    "The Cedar Ridge project uses bifacial solar panels from a Chinese supplier.",
    "Employees receive a $500 wellness stipend each year.",
    "The company plans to issue a green bond in 2026.",
]


def _contexts():
    return [
        {"chunk_id": f"c{i}", "document_id": f"d{i}", "document_name": f"doc{i}.pdf", "content": text}
        for i, text in enumerate(CHUNKS)
    ]


@pytest.mark.slow
@pytest.mark.skipif(os.getenv("EVAL_RUN") != "1", reason="set EVAL_RUN=1 (downloads the NLI model) to run")
async def test_truth_lens_verdicts_on_golden_set():
    from app.generation.guardrail import check

    verdicts = {}
    for label, claims in (("S", SUPPORTED), ("C", CONTRADICTED), ("U", UNSUPPORTED)):
        start = time.perf_counter()
        result = await check(" ".join(claims), _contexts())
        elapsed = time.perf_counter() - start
        assert [c["text"] for c in result.claims] == claims
        verdicts[label] = [c["verdict"] for c in result.claims]
        print(f"{label}: {elapsed:.2f}s {verdicts[label]}")

    assert verdicts["S"].count("supported") >= 6
    assert "contradicted" not in verdicts["S"]
    assert "supported" not in verdicts["C"]
    assert verdicts["C"].count("contradicted") >= 5
    assert "supported" not in verdicts["U"]
    assert "contradicted" not in verdicts["U"]
