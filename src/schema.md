# FactSet Earnings Insight — Parsed JSON Schema

The parser reads a FactSet *Earnings Insight* PDF and emits a JSON document with this shape. All fields are nullable — missing values become `null` rather than throwing, so the dashboard renders even when FactSet changes wording slightly.

```jsonc
{
  "meta": {
    "asOfDate": "April 24, 2026",        // FactSet's report date (string)
    "quarter": "Q1 2026",
    "sourcePdf": "EarningsInsight_042426.pdf",
    "parsedAt": "2026-04-26T20:35:00Z",
    "pageCount": 36
  },

  "keyMetrics": {
    "pctReported": 28,
    "pctBeatEps": 84,
    "pctBeatRevenue": 81,
    "blendedEarningsGrowth": 15.1,
    "blendedRevenueGrowth": 10.3,
    "negativeGuidanceCount": 11,
    "positiveGuidanceCount": 9,
    "fwdPe": 20.9,
    "fwdPe5yr": 19.9,
    "fwdPe10yr": 18.9
  },

  "scorecard": {
    "epsBeat":         { "current": 84,   "avg1yr": 79,   "avg5yr": 78,   "avg10yr": 76 },
    "epsSurprise":     { "current": 12.3, "avg1yr": 7.2,  "avg5yr": 7.3,  "avg10yr": 7.1 },
    "revenueBeat":     { "current": 81,   "avg1yr": 73,   "avg5yr": 70,   "avg10yr": 67 },
    "revenueSurprise": { "current": 2.0,  "avg1yr": 1.6,  "avg5yr": 2.0,  "avg10yr": 1.5 }
  },

  // 11 GICS sectors. Missing metrics = null.
  "sectorMatrix": [
    {
      "sector": "Information Technology",
      "epsBeatPct": 93,
      "revBeatPct": null,
      "epsSurprise": 21.1,
      "revSurprise": 5.8,
      "earningsGrowth": 46.3,
      "revenueGrowth": 28.1,
      "netProfitMargin": 29.1,
      "netProfitMargin5yr": 25.3,
      "netProfitMarginYearAgo": 25.4
    }
    // ... 10 more sectors
  ],

  // industry-level breakdown within each sector (earnings growth + revenue growth)
  "sectorIndustries": {
    "Information Technology": {
      "earnings": [
        { "industry": "Semiconductors & Semiconductor Equipment", "growth": 98 },
        { "industry": "Software", "growth": 18 }
      ],
      "revenue": [
        { "industry": "Semiconductors & Semiconductor Equipment", "growth": 51 }
      ]
    }
  },

  // Per-sector: companies FactSet calls out as significant contributors
  "companyContributors": {
    "Information Technology": {
      "companies": [
        { "company": "NVIDIA",            "actualEps": 1.74,  "estimateEps": 0.81 },
        { "company": "Micron Technology", "actualEps": 12.20, "estimateEps": 9.19 }
      ],
      "exContributor": {
        "excluding": ["NVIDIA", "Micron Technology"],
        "adjustedGrowth": 23.3,
        "fullGrowth": 46.3
      }
    }
  },

  "marketReaction": {
    "positiveSurprise": { "current": 0.9,  "avg5yr": 1.0 },
    "negativeSurprise": { "current": -2.6, "avg5yr": -2.9 }
  },

  "revisions": {
    "earningsGrowth": { "current": 15.1, "lastWeek": 13.0, "endOfQuarter": 13.1 },
    "revenueGrowth":  { "current": 10.3, "lastWeek": 10.0, "endOfQuarter":  9.9 },
    "sectorSinceQuarterEnd": [
      { "sector": "Industrials", "current": 16.7, "endOfQuarter":  3.3 },
      { "sector": "Energy",      "current": -14.4, "endOfQuarter":  8.3 }
    ]
  },

  "forwardEstimates": {
    "Q2_2026": { "earningsGrowth": 20.6, "revenueGrowth": 10.7, "netProfitMargin": 14.1 },
    "Q3_2026": { "earningsGrowth": 22.7, "revenueGrowth":  9.5, "netProfitMargin": 14.6 },
    "Q4_2026": { "earningsGrowth": 20.4, "revenueGrowth":  9.1, "netProfitMargin": 14.6 },
    "CY_2026": { "earningsGrowth": 18.6, "revenueGrowth":  9.5 },
    "CY_2027": { "earningsGrowth": null, "revenueGrowth": null }
  },

  "guidance": {
    "nextQuarter": {
      "label": "Q2 2026",
      "negative": 11, "positive": 9, "total": 20,
      "negPct": 55, "negPct5yr": 58, "negPct10yr": 60
    },
    "fullYear": { "negative": 138, "positive": 124, "total": 262, "negPct": 53 }
  },

  "valuation": {
    "fwdPe":      { "current": 20.9, "avg5yr": 19.9, "avg10yr": 18.9, "endOfQuarter": 19.7 },
    "trailingPe": { "current": 28.1, "avg5yr": 24.6, "avg10yr": 23.3 },
    "sectorFwdPe": [
      { "sector": "Consumer Discretionary", "fwdPe": 28.2 },
      { "sector": "Energy",                 "fwdPe": 14.6 },
      { "sector": "Financials",             "fwdPe": 14.8 }
    ]
  },

  "targets": {
    "bottomUpTarget": 8362.16,
    "currentPrice":   7108.40,
    "upsidePct":      17.6,
    "sectorUpside": [
      { "sector": "Health Care",            "upsidePct": 23.0 },
      { "sector": "Information Technology", "upsidePct": 21.4 }
    ]
  },

  "ratings": {
    "totalRatings": 12941,
    "buyPct":  58.4,
    "holdPct": 36.3,
    "sellPct":  5.3,
    "sectorBuyPct": [
      { "sector": "Information Technology", "buyPct": 68 }
    ]
  },

  "netProfitMargin": {
    "current": 13.4, "previousQuarter": 13.2, "yearAgo": 12.8, "avg5yr": 12.3
  },

  "nextWeek": {
    "companiesReporting": 181,
    "dow30Components": 11
  }
}
```

## Page-citation map

`build-dashboard.mjs` writes a `Raw Data` sheet that includes the page number each value came from. The parser tags each extracted value with the page index so this is preserved end-to-end.
