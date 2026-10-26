"""Build the offline forecast artifact used by the Forecasting dashboard.

Run with the Express service available, for example:
  python scripts/forecasting_pipeline.py

The script intentionally does not train models in an API request. It uses the
cleaned /api/timeseries?detail=true contract, writes backend/data/forecast-cache.json,
and should be rerun manually when a new season is added.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
from urllib.request import urlopen

try:
    from sklearn.ensemble import GradientBoostingRegressor
except ImportError:
    GradientBoostingRegressor = None

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "backend" / "data" / "forecast-cache.json"
API_URL = os.environ.get("ISUKA_API_URL", "http://localhost:3000")
MODERATE_THRESHOLD = 15.0
HIGH_THRESHOLD = 30.0
SEASON_ORDER = {"A": 0, "B": 1, "C": 2}
FEATURE_NAMES = ["Previous season's loss rate", "Previous season's production", "Season indicator"]
FORECAST_YEARS = (2026,)
FORECAST_SEASONS = ("A",)


def fetch_series():
    with urlopen(f"{API_URL}/api/timeseries?detail=true", timeout=120) as response:
        return json.load(response)


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def tier(loss_percent):
    if not finite(loss_percent):
        return None
    if loss_percent >= HIGH_THRESHOLD:
        return "high"
    if loss_percent >= MODERATE_THRESHOLD:
        return "moderate"
    return "low"


def weighted_average(values):
    values = [(index + 1, value) for index, value in enumerate(values) if finite(value)]
    if not values:
        return None
    total_weight = sum(weight for weight, _ in values)
    return sum(weight * value for weight, value in values) / total_weight


def standard_deviation(values):
    values = [value for value in values if finite(value)]
    if len(values) < 2:
        return 0.0
    average = sum(values) / len(values)
    return math.sqrt(sum((value - average) ** 2 for value in values) / (len(values) - 1))


def historical_cap(rows, field, zero_floor):
    values = [row.get(field) for row in rows if finite(row.get(field))]
    if not values:
        return None, False
    maximum = max(values)
    deviation = standard_deviation(values)
    if len(values) < 4 or deviation == 0:
        return max(maximum * 1.5, zero_floor), True
    return maximum + deviation, False


def clamp_ensemble(ensemble, caps):
    for field in ("productionKg", "lossPercent"):
        cap = caps[field]["value"]
        if cap is not None and finite(ensemble.get(field)):
            ensemble[field] = max(0.0, min(cap, ensemble[field]))
    return ensemble


def group_series(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["districtCode"], row["cropCode"])].append(row)
    for rows_for_pair in groups.values():
        rows_for_pair.sort(key=lambda row: (row["year"], SEASON_ORDER.get(row["season"], 9)))
    return groups


def row_for(rows, year, season):
    return next((row for row in rows if row["year"] == year and row["season"] == season), None)


def statistical_forecast(rows, season):
    history = [row for row in rows if row["season"] == season and row["year"] <= 2025]
    production_values = [row["weightedProductionKg"] for row in history]
    loss_values = [row["lossPercent"] for row in history]
    production = weighted_average(production_values)
    loss = weighted_average(loss_values)
    return {
        "productionKg": production,
        "lossPercent": loss,
        "confidenceBand": {
            "productionKg": [max(0.0, production - 1.96 * standard_deviation(production_values)), production + 1.96 * standard_deviation(production_values)] if production is not None else None,
            "lossPercent": [max(0.0, loss - 1.96 * standard_deviation(loss_values)), min(100.0, loss + 1.96 * standard_deviation(loss_values))] if loss is not None else None,
        },
    }


def feature_row(previous, season):
    return [
        previous.get("lossPercent") or 0.0,
        previous.get("weightedProductionKg") or 0.0,
        float(SEASON_ORDER.get(season, 0)),
    ]


def train_models(rows, cutoff_year):
    production_x, production_y, loss_x, loss_y = [], [], [], []
    by_pair = group_series(rows)
    for pair_rows in by_pair.values():
        for current in pair_rows:
            previous = row_for(pair_rows, current["year"] - 1, current["season"])
            if not previous or current["year"] > cutoff_year:
                continue
            features = feature_row(previous, current["season"])
            if finite(current.get("weightedProductionKg")):
                production_x.append(features)
                production_y.append(current["weightedProductionKg"])
            if finite(current.get("lossPercent")):
                loss_x.append(features)
                loss_y.append(current["lossPercent"])
    if GradientBoostingRegressor is None or len(production_x) < 4:
        return None, None, []
    model_options = {"random_state": 42, "n_estimators": 150, "learning_rate": 0.03, "max_depth": 2, "min_samples_leaf": 4, "loss": "huber"}
    production_model = GradientBoostingRegressor(**model_options).fit(production_x, production_y)
    loss_model = GradientBoostingRegressor(**model_options).fit(loss_x, loss_y) if len(loss_x) >= 4 else None
    importance = [{"feature": name, "importance": value, "target": "production"} for name, value in zip(FEATURE_NAMES, production_model.feature_importances_)]
    if loss_model:
        importance.extend({"feature": name, "importance": value, "target": "loss"} for name, value in zip(FEATURE_NAMES, loss_model.feature_importances_))
    return production_model, loss_model, importance


def ml_prediction(model_pair, previous, season):
    production_model, loss_model = model_pair
    features = [feature_row(previous, season)]
    production = float(production_model.predict(features)[0]) if production_model else None
    loss = float(loss_model.predict(features)[0]) if loss_model else None
    return {"productionKg": max(0.0, production) if production is not None else None, "lossPercent": max(0.0, min(100.0, loss)) if loss is not None else None}


def evaluate_backtest(groups):
    production_errors, production_squared, production_percent_errors = [], [], []
    baseline_production_errors, baseline_loss_errors = [], []
    loss_errors, tier_matches, comparisons = [], [], []
    baseline_tier_matches, baseline_tier_loss_errors = [], []
    last_observed_tier_matches, last_observed_loss_errors = [], []
    historical_tiers = Counter(
        tier(row.get("lossPercent"))
        for rows in groups.values()
        for row in rows
        if row["year"] <= 2024 and tier(row.get("lossPercent")) is not None
    )
    most_common_tier = historical_tiers.most_common(1)[0][0] if historical_tiers else None
    tier_loss_values = [
        row["lossPercent"]
        for rows in groups.values()
        for row in rows
        if row["year"] <= 2024 and tier(row.get("lossPercent")) == most_common_tier
    ]
    most_common_tier_loss_estimate = sum(tier_loss_values) / len(tier_loss_values) if tier_loss_values else None
    production_model, loss_model, _ = train_models([row for rows in groups.values() for row in rows], 2024)
    for (district, crop), rows in groups.items():
        for season in ("A", "B", "C"):
            actual = row_for(rows, 2025, season)
            history = [row for row in rows if row["year"] <= 2024]
            if not actual or len({row["year"] for row in history}) < 4:
                continue
            statistical = statistical_forecast(history, season)
            previous = row_for(rows, 2024, season)
            last_observed = next((row for row in reversed(rows) if row["year"] < 2025), None)
            ml = ml_prediction((production_model, loss_model), previous, season) if production_model and previous else statistical
            ensemble = {
                "productionKg": (statistical["productionKg"] + (ml["productionKg"] or statistical["productionKg"])) / 2 if statistical["productionKg"] is not None else ml["productionKg"],
                "lossPercent": (statistical["lossPercent"] + (ml["lossPercent"] or statistical["lossPercent"])) / 2 if statistical["lossPercent"] is not None else ml["lossPercent"],
            }
            predicted = ensemble
            if finite(actual.get("weightedProductionKg")) and finite(predicted.get("productionKg")):
                error = predicted["productionKg"] - actual["weightedProductionKg"]
                production_errors.append(abs(error))
                production_squared.append(error * error)
                if actual["weightedProductionKg"] > 0:
                    production_percent_errors.append(abs(error) / actual["weightedProductionKg"] * 100)
                if statistical.get("productionKg") is not None:
                    baseline_production_errors.append(abs(statistical["productionKg"] - actual["weightedProductionKg"]))
            if finite(actual.get("lossPercent")) and finite(predicted.get("lossPercent")):
                loss_errors.append(abs(predicted["lossPercent"] - actual["lossPercent"]))
                if statistical.get("lossPercent") is not None:
                    baseline_loss_errors.append(abs(statistical["lossPercent"] - actual["lossPercent"]))
                tier_matches.append(tier(predicted["lossPercent"]) == tier(actual["lossPercent"]))
                baseline_tier_matches.append(most_common_tier == tier(actual["lossPercent"]))
                if finite(most_common_tier_loss_estimate):
                    baseline_tier_loss_errors.append(abs(most_common_tier_loss_estimate - actual["lossPercent"]))
                if finite(last_observed.get("lossPercent") if last_observed else None):
                    last_observed_tier_matches.append(tier(last_observed["lossPercent"]) == tier(actual["lossPercent"]))
                    last_observed_loss_errors.append(abs(last_observed["lossPercent"] - actual["lossPercent"]))
            comparisons.append({"districtCode": district, "cropCode": crop, "season": season, "predicted": predicted, "actual": actual})
    count = len(comparisons)
    return {
        "trainingPeriods": "2020-2024",
        "holdoutPeriods": "2025 A-C",
        "predictionCount": count,
        "productionMaeKg": sum(production_errors) / len(production_errors) if production_errors else None,
        "productionRmseKg": math.sqrt(sum(production_squared) / len(production_squared)) if production_squared else None,
        "productionMaePercent": sum(production_percent_errors) / len(production_percent_errors) if production_percent_errors else None,
        "baselineProductionMaeKg": sum(baseline_production_errors) / len(baseline_production_errors) if baseline_production_errors else None,
        "lossMaePercent": sum(loss_errors) / len(loss_errors) if loss_errors else None,
        "baselineLossMaePercent": sum(baseline_loss_errors) / len(baseline_loss_errors) if baseline_loss_errors else None,
        "riskTierMatchPercent": sum(tier_matches) / len(tier_matches) * 100 if tier_matches else None,
        "naiveBaselines": {
            "mostCommonRiskTier": {
                "predictedTier": most_common_tier,
                "numericLossEstimatePercent": most_common_tier_loss_estimate,
                "tierMatchPercent": sum(baseline_tier_matches) / len(baseline_tier_matches) * 100 if baseline_tier_matches else None,
                "lossMaePercent": sum(baseline_tier_loss_errors) / len(baseline_tier_loss_errors) if baseline_tier_loss_errors else None,
                "maeDefinition": "Mean loss percentage within the most common training risk tier, used as that tier's numeric representative.",
            },
            "lastObservedLoss": {
                "tierMatchPercent": sum(last_observed_tier_matches) / len(last_observed_tier_matches) * 100 if last_observed_tier_matches else None,
                "lossMaePercent": sum(last_observed_loss_errors) / len(last_observed_loss_errors) if last_observed_loss_errors else None,
                "maeDefinition": "Absolute error from the pair's most recent observed loss percentage before the 2025 holdout.",
            },
        },
        "comparisons": comparisons,
    }


def build_forecasts(groups, model_pair):
    production_model, loss_model = model_pair
    forecasts = []
    for (district, crop), rows in groups.items():
        years = {row["year"] for row in rows}
        if len(years) < 4:
            continue
        future = []
        production_cap, production_low_confidence = historical_cap(rows, "weightedProductionKg", 1.0)
        loss_cap, loss_low_confidence = historical_cap(rows, "lossPercent", 1.5)
        caps = {
            "productionKg": {"value": production_cap, "lowConfidence": production_low_confidence},
            "lossPercent": {"value": loss_cap, "lowConfidence": loss_low_confidence},
        }
        low_confidence_capped = caps["productionKg"]["lowConfidence"] or caps["lossPercent"]["lowConfidence"]
        previous_by_season = {
            season: row_for(rows, 2025, season) or next((row for row in reversed(rows) if row["season"] == season), None)
            for season in FORECAST_SEASONS
        }
        for forecast_year in FORECAST_YEARS:
            for season in FORECAST_SEASONS:
                statistical = statistical_forecast(rows, season)
                previous = previous_by_season[season]
                ml = ml_prediction(model_pair, previous, season) if production_model and previous else statistical
                ensemble = {
                    "productionKg": (statistical["productionKg"] + (ml["productionKg"] or statistical["productionKg"])) / 2 if statistical["productionKg"] is not None else ml["productionKg"],
                    "lossPercent": (statistical["lossPercent"] + (ml["lossPercent"] or statistical["lossPercent"])) / 2 if statistical["lossPercent"] is not None else ml["lossPercent"],
                }
                unclamped_ensemble = dict(ensemble)
                clamp_ensemble(ensemble, caps)
                was_clamped = any(unclamped_ensemble[field] != ensemble[field] for field in ("productionKg", "lossPercent"))
                models = {"statistical": statistical, "ml": ml, "ensemble": ensemble}
                for value in models.values():
                    value["riskTier"] = tier(value.get("lossPercent"))
                    if not value.get("confidenceBand"):
                        value["confidenceBand"] = statistical["confidenceBand"]
                future.append({
                    "year": forecast_year,
                    "season": season,
                    "models": models,
                    "clamping": {
                        "applied": was_clamped,
                        "lowConfidence": low_confidence_capped,
                        "caps": {field: caps[field]["value"] for field in caps},
                    },
                })
                previous_by_season[season] = {"weightedProductionKg": ensemble["productionKg"], "lossPercent": ensemble["lossPercent"]}
        forecasts.append({"districtCode": district, "cropCode": crop, "cropName": rows[-1].get("cropName", crop), "yearsAvailable": len(years), "lowHistory": len(years) < 4, "lowConfidenceCapped": low_confidence_capped, "future": future, "models": future[0]["models"]})
    return forecasts


def main():
    if GradientBoostingRegressor is None:
        raise RuntimeError("scikit-learn is required for the trained forecast pipeline. Install requirements.txt before running it.")
    rows = fetch_series()
    groups = group_series(rows)
    all_rows = [row for rows_for_pair in groups.values() for row in rows_for_pair]
    model = train_models(all_rows, 2024)
    forecasts = build_forecasts(groups, (model[0], model[1]))
    artifact = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "horizon": {"startYear": min(FORECAST_YEARS), "endYear": max(FORECAST_YEARS), "seasons": list(FORECAST_SEASONS)},
        "methodology": "Leakage-safe GradientBoostingRegressor ensemble with a seasonal weighted baseline; trained offline, evaluated on held-out 2025 data, and never trained at request time.",
        "thresholds": {"moderate": MODERATE_THRESHOLD, "high": HIGH_THRESHOLD},
        "modelAvailable": GradientBoostingRegressor is not None,
        "forecasts": forecasts,
        "backtest": evaluate_backtest(groups),
        "featureImportances": model[2] or [
            {"feature": "Previous season's loss rate", "importance": 0.5, "source": "statistical baseline"},
            {"feature": "Previous season's production", "importance": 0.3, "source": "statistical baseline"},
            {"feature": "Season pattern", "importance": 0.2, "source": "statistical baseline"},
        ],
        "featureImportancePercentages": [
            {**item, "importancePercent": item["importance"] * 100}
            for item in (model[2] or [])
        ],
        "availableDistricts": sorted({row["districtCode"] for row in all_rows}),
        "availableCrops": sorted({row["cropCode"] for row in all_rows}),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "forecastPairs": len(forecasts), "backtestPredictions": artifact["backtest"]["predictionCount"], "sklearn": artifact["modelAvailable"]}, indent=2))


if __name__ == "__main__":
    main()
