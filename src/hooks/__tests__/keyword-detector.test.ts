import { test } from "node:test";
import assert from "node:assert/strict";
import { detectKeyword } from "../keyword-detector.js";

test("detectKeyword: explicit $ralph invocation is high-confidence ralph", () => {
  const result = detectKeyword("$ralph fix the build");
  assert.equal(result.intent, "ralph");
  assert.equal(result.rawKeyword, "$ralph");
  assert.equal(result.confidence, "high");
});

test("detectKeyword: $TEAM is matched case-insensitively as team", () => {
  const result = detectKeyword("$TEAM 3:executor build");
  assert.equal(result.intent, "team");
  assert.equal(result.confidence, "high");
});

test("detectKeyword: prose mention of ralph without $ does not activate", () => {
  const result = detectKeyword("just talking about ralph in passing");
  assert.equal(result.intent, null);
  assert.equal(result.rawKeyword, null);
});

test("detectKeyword: explicit $deep-interview activates deep-interview", () => {
  const result = detectKeyword("$deep-interview clarify scope");
  assert.equal(result.intent, "deep-interview");
  assert.equal(result.rawKeyword, "$deep-interview");
  assert.equal(result.confidence, "high");
});

test("detectKeyword: plain greeting returns null intent", () => {
  const result = detectKeyword("hi there");
  assert.equal(result.intent, null);
  assert.equal(result.rawKeyword, null);
  assert.equal(result.confidence, "low");
});

test("detectKeyword: Korean IME drift `$ㅕㅣㅈ` normalizes to ultrawork", () => {
  const result = detectKeyword("$ㅕㅣㅈ run a parallel sweep");
  assert.equal(result.intent, "ultrawork");
});

test("detectKeyword: when multiple keywords appear, the first occurrence wins", () => {
  const result = detectKeyword("$team please then $ralph after");
  assert.equal(result.intent, "team");
  assert.equal(result.rawKeyword, "$team");
});

test("detectKeyword: activation phrase without $ matches with medium confidence", () => {
  const result = detectKeyword("please start ralph and continue from yesterday");
  assert.equal(result.intent, "ralph");
  assert.equal(result.confidence, "medium");
});
