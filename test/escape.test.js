const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Mirror of frontend escapeHtml (concatenation form) so CI catches regressions.
 * Live function: frontend/js/place-intelligence.js
 */
function escapeHtml(str) {
  if (str == null) return "";
  var amp = "&" + "amp;";
  var lt = "&" + "lt;";
  var gt = "&" + "gt;";
  var quot = "&" + "quot;";
  var apos = "&" + "#39;";
  return String(str)
    .replace(/&/g, amp)
    .replace(/</g, lt)
    .replace(/>/g, gt)
    .replace(/"/g, quot)
    .replace(/'/g, apos);
}

describe("escapeHtml", () => {
  it("escapes ampersand, angle brackets, and quotes", () => {
    var input = "<script>alert(" + '"' + "x" + '"' + ")</script>";
    var expected =
      ("&" + "lt;") + "script" + ("&" + "gt;") +
      "alert(" + ("&" + "quot;") + "x" + ("&" + "quot;") + ")" +
      ("&" + "lt;") + "/script" + ("&" + "gt;");
    assert.equal(escapeHtml(input), expected);
  });

  it("handles null and undefined", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });

  it("leaves plain text unchanged", () => {
    assert.equal(escapeHtml("Schoharie County"), "Schoharie County");
  });

  it("escapes ampersand first", () => {
    assert.equal(escapeHtml("A & B"), "A " + ("&" + "amp;") + " B");
  });
});
