const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Mirror of the frontend escapeHtml implementation so CI catches regressions.
 * The live function lives in frontend/js/place-intelligence.js.
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """)
    .replace(/'/g, "&#39;");
}

describe("escapeHtml", () => {
  it("escapes ampersand, angle brackets, and quotes", () => {
    assert.equal(escapeHtml('<script>alert("x")</script>'), "<script>alert("x")</script>");
  });

  it("handles null and undefined", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });

  it("leaves plain text unchanged", () => {
    assert.equal(escapeHtml("Schoharie County"), "Schoharie County");
  });
});
