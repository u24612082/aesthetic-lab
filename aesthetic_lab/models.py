from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class TechniqueScores(StrictModel):
    # Preserve the reference integration's score names and 1–5 scale.
    amplitudeStableScore: int | None = Field(default=None, ge=1, le=5)
    forceControlScore: int | None = Field(default=None, ge=1, le=5)
    completionScore: int | None = Field(default=None, ge=1, le=5)
    bilateralBalanceScore: int | None = Field(default=None, ge=0, le=5)
    evidence_source: str = Field(min_length=1, max_length=160)


class SetRecord(StrictModel):
    exercise: str = Field(min_length=1, max_length=160)
    reps: int = Field(gt=0, le=200)
    load: float = Field(ge=0, le=2000)
    unit: Literal["kg", "lb"] = "kg"
    rir: float | None = Field(default=None, ge=0, le=10)
    warmup: bool = False
    side: Literal["left", "right", "bilateral", "unknown"] = "unknown"
    equipment_id: str | None = Field(default=None, min_length=1, max_length=160)
    resistance_mode: Literal["standard", "eccentric", "concentric", "unknown"] = "unknown"
    technique: TechniqueScores | None = None


class Workout(StrictModel):
    external_id: str = Field(min_length=1, max_length=200)
    revision: int = Field(default=1, ge=1)
    name: str = Field(default="Strength training", min_length=1, max_length=160)
    started_at: datetime
    ended_at: datetime
    source_bundle: str | None = Field(default=None, max_length=200)
    detail_level: Literal["summary", "sets"]
    sets: list[SetRecord] = Field(default_factory=list, max_length=1000)

    @field_validator("started_at", "ended_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Timezone offset is required")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def consistency(self):
        if self.ended_at < self.started_at:
            raise ValueError("ended_at precedes started_at")
        if self.detail_level == "summary" and self.sets:
            raise ValueError("Summary records cannot contain sets")
        if self.detail_level == "sets" and not self.sets:
            raise ValueError("Set-level records require sets")
        return self


class IngestBatch(StrictModel):
    schema_version: Literal[1] = 1
    source: Literal["liftoff-healthkit", "liftoff-adapter"]
    workouts: list[Workout] = Field(min_length=1, max_length=100)


class FoodInput(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    brand: str = Field(default="Custom", max_length=120)
    kcal: float = Field(ge=0, le=1000)
    protein: float = Field(ge=0, le=100)
    carbs: float = Field(ge=0, le=100)
    fat: float = Field(ge=0, le=100)
    basis: str = Field(default="per 100 g as sold", max_length=100)


class FoodLogInput(StrictModel):
    request_id: str = Field(min_length=8, max_length=100)
    food_id: int = Field(gt=0)
    local_date: date
    meal: Literal["Breakfast", "Lunch", "Dinner", "Snacks"]
    grams: float = Field(gt=0, le=10000)


class FoodLogEdit(StrictModel):
    local_date: date
    meal: Literal['Breakfast','Lunch','Dinner','Snacks']
    grams: float = Field(gt=0,le=10000)


class FoodFavorite(StrictModel):
    favorite: bool = Field(strict=True)


class NutritionTargets(StrictModel):
    kcal: float | None = Field(default=None,gt=0,le=10000)
    protein: float | None = Field(default=None,gt=0,le=1000)
    carbs: float | None = Field(default=None,gt=0,le=2000)
    fat: float | None = Field(default=None,gt=0,le=1000)


class NutritionDay(StrictModel):
    local_date:date
    complete:bool


class Login(StrictModel):
    token: str = Field(max_length=256)


class CoachConnection(StrictModel):
    api_key: SecretStr


class CoachAutomation(StrictModel):
    enabled: bool = Field(strict=True)


class Adjustment(StrictModel):
    target: str = Field(max_length=80)
    weekly_set_delta: int = Field(ge=-4, le=4)
    reason: str = Field(max_length=600)


class CoachReport(StrictModel):
    summary: str = Field(max_length=1500)
    aesthetic_audit: list[str] = Field(max_length=10)
    fatigue_signals: list[str] = Field(max_length=10)
    nutrition_notes: list[str] = Field(max_length=10)
    adjustments: list[Adjustment] = Field(max_length=10)
    limitations: list[str] = Field(max_length=10)
