import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, validatePin, validateNewPin, escapeHtml, parseQrPayload } from "../src/core.js";

test("normalizes a UAE local mobile number", () => assert.equal(normalizePhone("050 123 4567"), "+971501234567"));
test("normalizes a UAE mobile without the domestic zero", () => assert.equal(normalizePhone("501234567"), "+971501234567"));
test("normalizes a UAE country code without plus", () => assert.equal(normalizePhone("971501234567"), "+971501234567"));
test("removes an accidental domestic zero after +971", () => assert.equal(normalizePhone("+9710501234567"), "+971501234567"));
test("preserves an international number", () => assert.equal(normalizePhone("+44 7700 900123"), "+447700900123"));
test("rejects an invalid phone", () => assert.throws(() => normalizePhone("123")));
test("accepts exactly six PIN digits", () => assert.equal(validatePin("482915"), "482915"));
test("rejects a weak PIN format", () => assert.throws(() => validatePin("12345")));
test("allows an existing customer to enter any six-digit PIN", () => assert.equal(validatePin("123456"), "123456"));
test("accepts a less predictable new PIN", () => assert.equal(validateNewPin("482915"), "482915"));
test("rejects repeated and sequential new PINs", () => {
  for (const pin of ["000000", "111111", "123456", "654321", "121212"]) {
    assert.throws(() => validateNewPin(pin), /less predictable/);
  }
});
test("escapes user-supplied HTML", () => assert.equal(escapeHtml(`<img src=x onerror='x'>`), "&lt;img src=x onerror=&#39;x&#39;&gt;"));
test("parses a direct QR payload", () => assert.equal(parseQrPayload(`loyalty:v1:${"A".repeat(43)}`), "A".repeat(43)));
test("parses a fragment URL without using the query string", () => assert.equal(parseQrPayload(`https://example.test/#/scan/${"b".repeat(43)}`), "b".repeat(43)));
