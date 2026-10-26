import json
import os
from pathlib import Path

try:
    import pandas as pd
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, classification_report
except ImportError as exc:  # pragma: no cover
    raise SystemExit(f"Missing ML dependencies: {exc}")

ROOT = Path(__file__).resolve().parents[1]
TRAINING_PATH = ROOT / "backend" / "data" / "dataset-training-history.json"
MODEL_PATH = ROOT / "backend" / "data" / "dataset-acceptance-model.json"


def load_history():
    if not TRAINING_PATH.exists():
        return []
    with TRAINING_PATH.open("r", encoding="utf-8") as handle:
        try:
            payload = json.load(handle)
        except json.JSONDecodeError:
            return []
    return payload if isinstance(payload, list) else []


def train_model():
    rows = load_history()
    if not rows:
        return {
            "status": "empty",
            "message": "No historical dataset decisions available yet. Add accept/reject records before training.",
            "modelAvailable": False,
        }

    frame = pd.DataFrame(rows)
    feature_columns = [
        "readabilityScore",
        "schemaScore",
        "completenessScore",
        "fitScore",
        "readinessScore",
        "missingValueRate",
        "outlierRate",
        "duplicateRowsRemoved",
        "invalidRows",
        "rowCount",
        "warningsCount",
        "hasMissingColumns",
        "hasDuplicateHeaders",
        "yearMismatch",
        "seasonMismatch",
        "hasPeriodMismatch",
        "modelReady",
        "modelLimited",
    ]

    for column in feature_columns:
        if column not in frame.columns:
            frame[column] = 0

    X = frame[feature_columns]
    y = frame["label"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42, stratify=y)
    model = RandomForestClassifier(n_estimators=200, random_state=42, class_weight="balanced")
    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    accuracy = accuracy_score(y_test, predictions)
    report = classification_report(y_test, predictions, output_dict=True)

    model_payload = {
        "status": "trained",
        "modelAvailable": True,
        "accuracy": float(accuracy),
        "featureColumns": feature_columns,
        "report": report,
        "model": {
            "type": "RandomForestClassifier",
            "n_estimators": 200,
            "random_state": 42,
            "class_weight": "balanced",
            "feature_importances": [float(value) for value in model.feature_importances_],
        },
    }

    with (ROOT / "backend" / "data" / "dataset-acceptance-model.json").open("w", encoding="utf-8") as handle:
        json.dump(model_payload, handle, indent=2)

    return model_payload


def main():
    result = train_model()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
