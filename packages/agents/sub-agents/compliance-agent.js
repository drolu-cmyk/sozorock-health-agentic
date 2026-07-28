/**
 * Compliance Agent
 * Deterministic policy enforcement.
 * Blocks any output that violates non-clinical or source-traceability rules.
 */

class ComplianceAgent {
  check(package_) {
    const violations = [];

    if (!package_) {
      violations.push("Empty package");
      return { ok: false, violations };
    }

    // Hard non-clinical rule
    if (package_.clinicalAdvice || package_.diagnosis || package_.treatment || package_.prescription) {
      violations.push("Clinical content is not permitted");
    }

    // Required meta flags
    if (!package_.meta || package_.meta.nonClinical !== true) {
      violations.push("Missing required nonClinical=true declaration");
    }
    if (!package_.meta || package_.meta.sourceTraceable !== true) {
      violations.push("Missing required sourceTraceable=true declaration");
    }

    // Source freshness is mandatory
    if (!package_.meta?.sourceFreshness && !package_.evidence?.freshness) {
      violations.push("Source freshness is required");
    }

    // Evidence must carry citations when present
    if (package_.evidence?.sources) {
      const missingCitation = package_.evidence.sources.some(s => !s.citation || !s.releaseDate);
      if (missingCitation) {
        violations.push("Every source must include citation and releaseDate");
      }
    }

    return {
      ok: violations.length === 0,
      violations
    };
  }
}

module.exports = { ComplianceAgent };
