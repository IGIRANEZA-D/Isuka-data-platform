# Loss Planner Data Contract

## Baseline

`GET /api/loss-planner/baseline?years=2025&seasons=C`

Both `years` and `seasons` accept a comma-separated selection or `all`. A multi-period response sums kilograms and record counts across its listed periods. Stage coverage is the share of weighted production from records with stage data. A stage is available only when every field in its group has a confirmed kilogram unit for that period.

The compact response shape is:

```json
{
  "meta": { "periods": [], "generatedAt": "", "calcVersion": "", "minRecords": 30, "notes": [] },
  "crops": [{ "code": "", "name": "" }],
  "districts": [{ "code": "", "name": "", "province": "" }],
  "stages": [{ "id": "", "label": "", "availablePeriods": [], "unitStatus": "confirmed" }],
  "rows": [{ "d": "", "c": "", "productionKg": 0, "stageKg": {}, "unattributedKg": 0, "totalLossKg": 0, "records": 0, "stageRecords": 0, "stageCoveragePct": 0, "priceRwfPerKg": null, "priceBasis": "none", "priceRecordCount": 0 }]
}
```

`stageKg` uses the keys `pests`, `animals`, `harvest`, `transport`, `storage`, `processing`, `sales`, and `other`. A `null` stage value means the source stage is unavailable for that period; it is not zero. `unattributedKg` is reported total less the sum of components, floored at zero. Rows whose components exceed the reported total are excluded from stage attribution and assigned wholly to unattributed loss. `meta.stageExceedTotalRows` reports their count.

Prices are self-reported selling prices in RWF/kg. The estimator uses the production-weighted median for district and crop when at least 30 price records exist; otherwise it uses the national crop median, or `null` if no crop price is available. `priceBasis` is `district`, `national`, or `none`.

## Default

`GET /api/loss-planner/default?years=all&seasons=all`

Returns the crop code and measured stage with the largest component volume in the latest matching period, with the default reduction of 30%. It returns null codes when no measured opportunity exists.

## Scenario helper

`frontend/lib/loss-scenario.js` exports `computeScenario`, `formatTonnes`, `formatRwf`, `formatSacks`, `coverageBand`, `afterLossRate`, and URL-state helpers. Scenario arithmetic is client-side; changing reduction percentage makes no network request. Cells below `meta.minRecords` are suppressed and excluded from scenario totals.

## Sample provenance

`frontend/fixtures/loss-planner-sample.json` is a trimmed sample of the live 2025-C Irish-potato baseline response. Values are the observed API output, not illustrative placeholders.