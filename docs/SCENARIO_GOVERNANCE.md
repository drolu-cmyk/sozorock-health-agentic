# Governed Scenario Intelligence

CB-CAP scenarios are planning sensitivities, not predictions. They answer a bounded question: **if an authorized user changes one reviewed assumption under one registered method, what does the arithmetic show?**

## Contract

Scenario outputs use `cbcap.scenario.v1` and are always labeled `scenario_output`.

A scenario can run only when all of the following are present:

1. one exact county;
2. an Evidence Gateway release ID and SHA256 package identity;
3. explicit user assumptions marked `source: user`;
4. a numeric point assumption with an explicit low/high range and unit;
5. explicit scenario context with a future horizon;
6. one server-owned scenario registration for the assumption key;
7. a verified, forecastable county baseline with one unambiguous reviewed value;
8. a source allowed by the registration;
9. a reviewed model registration whose maximum horizon has not been exceeded.

If any condition fails, the scenario is returned as blocked and no partial output is exposed as a usable scenario result.

## Client authority

The client may provide:

- assumption values;
- assumption ranges;
- assumption units;
- optional rationale;
- an optional as-of date;
- a required horizon end date.

The client may not provide or select:

- executable formulas;
- code;
- a model implementation;
- a model version;
- an evidence source;
- a baseline observation;
- a probability;
- an official priority or allocation decision.

The server resolves these from reviewed registrations and governed evidence.

## Registered methods

The first contract deliberately supports only transparent deterministic methods:

- `absolute_change`: `baseline + user_assumption`;
- `relative_fraction`: `baseline * (1 + user_assumption)`;
- `relative_percent`: `baseline * (1 + user_assumption / 100)`.

Arbitrary formulas are not accepted. Each registration binds one assumption key to one source measure, method, model version, method version, unit, allowed source set, maximum horizon, reviewer, and review date.

## Ranges and domains

Every scenario assumption needs a low/high range. The point assumption must fall inside that range. The runtime applies the same registered method to the low and high values and reports the resulting planning range.

For percentage measures, the output and range must remain within 0 to 100. Other domain-specific constraints require a reviewed adapter rather than an inferred rule.

## Evidence and time

The baseline must be verified at the measure, semantics, geography, and source-version levels. It must be marked forecastable by reviewed measure semantics. CB-CAP does not choose between multiple verified candidate baselines automatically.

The baseline observation period and retrieval date cannot be later than the scenario as-of date. The scenario horizon must be future to the as-of date and within the registered maximum horizon.

## Output semantics

A successful deterministic scenario explicitly states:

- Evidence state: `scenario_output`;
- official estimate: false;
- statistical prediction: false;
- probability of occurrence: null;
- human review required: true.

The output carries the Evidence Gateway release identity, baseline lineage, assumption, registered model and method versions, formula identifier, point result, range, and limitations.

## Consequential-use boundary

A scenario cannot by itself:

- become an official county forecast;
- create a county priority;
- determine a CHA/CHIP decision;
- determine grant eligibility or award likelihood;
- allocate money, staff, facilities, or services;
- become institutional memory without a separate authorized review path.

**AI drafts. People decide.**
