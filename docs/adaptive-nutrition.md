# Adaptive nutrition

Open **Nutrition → Calculate my macros** while the Mac is reachable. Enter age, height, an explicit energy-equation coefficient and overall activity, then choose slow lean surplus, slow cut or maintenance. A recent Stats weight takes priority over the optional starting weight. No demographic values are inferred from the app's body-map appearance. The planner remains unconfigured until you save your profile.

## Starting estimate and evidence

Resting energy uses the simplified [Mifflin–St Jeor equation](https://pubmed.ncbi.nlm.nih.gov/2305711/): `10 × kg + 6.25 × cm − 5 × age + 5` for the male equation or `−161` for the female equation. The chosen activity multiplier already includes training; the app does not add speculative calories burned from lifted tonnage. Estimated maintenance is a starting point, not measured metabolism.

Slow gain starts at estimated maintenance +5%, slow cut −10%, and maintenance at the estimate, rounded to 25 kcal. Protein starts at 2.0 g/kg for gain/maintenance and 2.2 g/kg for a cut. Fat is around 25% of energy, with a 0.6 g/kg minimum; carbohydrate takes the remaining energy. Targets reconcile using 4/4/9 kcal per gram, within rounding. The supported automated profile range is adults 18–80, BMI 18.5–40 and initial targets 1,500–6,000 kcal. These are software applicability limits, not individual clinical thresholds or a recommendation to diet at the lower bound.

Protein allocation and conservative advanced-athlete surpluses draw on the [off-season bodybuilding review](https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/) and [protein/resistance-training meta-analysis](https://pubmed.ncbi.nlm.nih.gov/28698222/). The [contest-preparation review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/) discusses slower loss and muscle retention; its higher protein range is expressed per **fat-free mass**, which this app does not measure. We do not apply that number to total body weight.

The selected scale-trend bands are +0.10–0.25%/week for slow gain, −0.50 to −0.25%/week for slow cut, and ±0.10%/week for maintenance. The slow-cut band is deliberately slower than many contest-preparation recommendations. These exact bands and the controller below are conservative engineering choices, not a clinically validated optimum. Scale mass includes water, glycogen and gut contents; it cannot identify fat or muscle change. Do not back-calculate expenditure using a fixed 7,700 kcal/kg conversion.

## Automatic adjustments

The Mac checks synced evidence once a minute, independently of Claude and without a paid model call. It holds until all these conditions pass:

- Fourteen days have elapsed since saving a phase/profile, and seven days since the last adjustment.
- At least three distinct weigh-in days exist in each of the latest two seven-day windows. Daily duplicates use the latest timestamp. Changes between weekly means are normalized by the actual gap between their mean measurement dates.
- At least 12 of 14 food days are explicitly marked **Day fully logged**, have entries and positive recorded energy. Partial days are excluded rather than treated as zero intake. The confirmation should include drinks, oils and supplements.
- Mean complete-day intake is within 10% of the current target, with a minimum 150 kcal tolerance. First establish consistent logging/intake when it is farther away.
- The observed 14-day weight range is no more than 4% of its mean. Larger swings hold adjustment.

If the trend is outside the phase band, calories change toward it by approximately 3%, rounded to 25 kcal and capped at 100 kcal. Protein and fat are recalculated from the recent mean weight and carbohydrates fill the remainder. Multiple comparable performance-decline flags hold further calorie reductions; they are not diagnoses of fatigue. Guardrails stop targets outside ±20% of the profile's current equation estimate or the supported calorie range. Technique scores continue to govern load progression independently.

Adjustments use a SQLite immediate transaction, recheck the current profile/targets/cooldown and retain a unique evidence fingerprint. A same-connection SQLite data-version check defers any adjustment if another connection committed while its evidence was being gathered, including food, workout or weight corrections. Concurrent worker attempts and retries cannot apply the same adjustment twice. Each phase start and automatic change records before/after targets and its evidence. No programme or training load changes automatically.

## Phase switching, manual targets and iPhone

Use **Change phase / settings** to move between gain and cut. Saving recalculates starting targets and resets the fourteen-day observation period; older phase history remains visible. Manual Daily targets pause automatic adjustments. Saving the planner again explicitly re-enables them if its checkbox is selected.

Workout/weight records and food entries are saved on the iPhone offline. Complete-day confirmations use the same durable, ordered, conflict-checked outbox as the food diary. Reopen the app with the Mac awake and reachable at home to sync. The Mac then runs the controller on the merged evidence; the phone downloads updated targets. Offline, the planner and coach show their last downloaded data. Initial setup/phase changes and fresh Claude generation require the Mac; iOS does not guarantee syncing a closed PWA in the background.

Analytics and both coaching paths receive recorded weight, weekly means, the configured phase, current macro targets, complete-day intake/protein evidence and adjustment holds. Protein per kilogram is calculated only when a recent seven-day weight mean and complete intake are available. The Claude Code subscription path remains separate from the optional API integration; no API key or paid-token fallback is introduced.
