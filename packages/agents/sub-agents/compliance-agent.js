/**
 * Compliance Agent
 *
 * Deterministic policy enforcement.
 * - Blocks clinical language in any text field
 * - Requires real source linkage (not just a boolean)
 * - Must be run after report generation so report content is evaluated
 */

const CLINICAL_PATTERNS = [
  /\bdiagnos(e|is|ed|ing)\b/i,
  /\btreat(ment|ed|ing)?\b/i,
  /\bprescri(be|ption|bed)\b/i,
  /\bmedication\b/i,
  /\bdosage\b/i,
  /\bclinical advice\b/i,
  /\bmedical advice\b/i,
  /\bsymptom(s)?\b/i,
  /\bprognosis\b/i
];

class ComplianceAgent {
  /**
   * Full check — call this AFTER the report has been attached.
   */
  check(package_) {
    const violations = [];

    if (!package_) {
      violations.push("Empty package");
      return { ok: false, violations };
    }

    // 1. Structural clinical fields
    if (package_.clinicalAdvice || package_.diagnosis || package_.treatment || package_.prescription) {
      violations.push("Clinical content fields are not permitted");
    }

    // 2. Required meta flags
    if (!package_.meta || package_.meta.nonClinical !== true) {
      violations.push("Missing required nonClinical=true declaration");
    }

    // 3. Source freshness required
    const freshness = package_.meta?.sourceFreshness || package_.evidence?.freshness;
    if (!freshness) {
      violations.push("Source freshness is required");
    }

    // 4. Real source linkage — every source must have citation + releaseDate
    const sources = package_.evidence?.sources || [];
    if (sources.length === 0) {
      violations.push("At least one cited source is required");
    }
    sources.forEach((s, i) => {
      if (!s.citation) violations.push(`Source[${i}] missing citation`);
      if (!s.releaseDate) violations.push(`Source[${i}] missing releaseDate`);
    });

    // 5. Text inspection for clinical language across the package
    const textBlobs = collectText(package_);
    for (const text of textBlobs) {
      for (const pattern of CLINICAL_PATTERNS) {
        if (pattern.test(text)) {
          violations.push(`Clinical language detected: "${pattern.source}"`);
          break;
        }
      }
    }

    // 6. sourceTraceable flag is not sufficient by itself
    // We only accept it if sources actually exist and are complete
    if (package_.meta?.sourceTraceable === true && sources.length === 0) {
      violations.push("sourceTraceable=true is invalid without linked sources");
    }

    return {
      ok: violations.length === 0,
      violations: [...new Set(violations)]
    };
  }
}

function collectText(obj, acc = []) {
  if (obj == null) return acc;
  if (typeof obj === "string") {
    acc.push(obj);
    return acc;
  }
  if (Array.isArray(obj)) {
    obj.forEach(item => collectText(item, acc));
    return acc;
  }
  if (typeof obj === "object") {
    Object.values(obj).forEach(v => collectText(v, acc));
  }
  return acc;
}

module.exports = { ComplianceAgent };
