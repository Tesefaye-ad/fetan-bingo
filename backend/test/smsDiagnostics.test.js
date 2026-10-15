"use strict";
// npm: node --test test/  — forwarder ምርመራ + route ባህሪ (ያለ MongoDB/Express)
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const docs = [];
const q = (v) => { const p = Promise.resolve(v); p.sort = () => p; p.select = () => p; p.lean = () => p; return p; };
const FakeMerchantSms = {
  countDocuments: async (f) => docs.filter((d) => d.createdAt >= f.createdAt.$gte).length,
  findOne: (f) => q((f.txnId ? docs.find((d) => d.txnId === f.txnId) : [...docs].sort((a, b) => b.createdAt - a.createdAt)[0]) || null),
};
const FakeTx = { findOne: () => q(null) };
let handler;
const fakeExpress = () => ({});
fakeExpress.Router = () => ({ use() {}, post: (_p, h) => { handler = h; } });
fakeExpress.urlencoded = () => () => {};
fakeExpress.text = () => () => {};
const ingested = [];
const ol = Module._load;
Module._load = function (r, p, i) {
  if (r.endsWith("models/MerchantSms")) return FakeMerchantSms;
  if (r.endsWith("models/Transaction")) return FakeTx;
  if (r === "express") return fakeExpress;
  if (r.endsWith("services/telebirr/merchantSms")) return { ingestMerchantSms: async ({ text }) => (text.includes("received") ? { ok: true, txnId: "DJF5T7GTM7", amount: 50, duplicate: false } : { ok: false, reason: "unparseable", errors: ["amount_missing"] }) };
  return ol.apply(this, arguments);
};
const diag = require("../services/telebirr/smsDiagnostics");
require("../routes/merchantSmsRoute");

const mkRes = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
const TOKEN = "t".repeat(32);

test("route: 503 / 401 (?token=) / 401 (wrong) / 400 / unparseable / ok — እያንዳንዱ ይመዘገባል", async () => {
  const warn = console.warn; console.warn = () => {}; console.log = () => {};
  process.env.MERCHANT_SMS_TOKEN = "short";
  let res = mkRes(); await handler({ headers: {}, query: {}, body: { message: "x" } }, res);
  assert.equal(res.code, 503); assert.equal((await diag.smsStatus(process.env)).lastAttempt.outcome, "not_configured");

  process.env.MERCHANT_SMS_TOKEN = TOKEN;
  res = mkRes(); await handler({ headers: {}, query: { token: TOKEN }, body: { message: "x" } }, res);
  assert.equal(res.code, 401);
  let s = await diag.smsStatus(process.env);
  assert.equal(s.lastAttempt.outcome, "unauthorized"); assert.equal(s.lastAttempt.detail, "?token=");
  assert.match(diag.formatStatus(s), /\?token=/);

  res = mkRes(); await handler({ headers: { "x-forwarder-token": "nope" }, query: {}, body: { message: "x" } }, res);
  assert.equal(res.code, 401); assert.equal((await diag.smsStatus(process.env)).lastAttempt.detail, "wrong token");

  res = mkRes(); await handler({ headers: { "x-forwarder-token": TOKEN }, query: {}, body: {} }, res);
  assert.equal(res.code, 400); assert.equal((await diag.smsStatus(process.env)).lastAttempt.outcome, "message_missing");

  res = mkRes(); await handler({ headers: { authorization: "Bearer " + TOKEN }, query: {}, body: { message: "garbage" } }, res);
  assert.equal((await diag.smsStatus(process.env)).lastAttempt.outcome, "unparseable");

  res = mkRes(); await handler({ headers: { "x-forwarder-token": TOKEN }, query: {}, body: { message: "You have received ETB 50" } }, res);
  assert.equal(res.body.ok, true); s = await diag.smsStatus(process.env);
  assert.equal(s.lastAttempt.outcome, "ok"); assert.equal(s.counts.unauthorized, 2);
  console.warn = warn;
});

test("smsStatus/formatStatus: ጠፍቷል/በርቷል, ቆጠራ, token አይታተምም", async () => {
  docs.push({ txnId: "DJF5T7GTM7", amount: 50, createdAt: new Date(Date.now() - 600000), smsTimestampRaw: "15/10/2026 07:23:07" });
  const on = await diag.smsStatus({ MERCHANT_SMS_TOKEN: "s3cr3t-".repeat(5) });
  const txt = diag.formatStatus(on);
  assert.equal(on.enabled, true); assert.equal(on.c1h, 1); assert.ok(txt.includes("DJF5T7GTM7")); assert.ok(!txt.includes("s3cr3t"), "token never printed");
  const off = await diag.smsStatus({});
  assert.equal(off.enabled, false); assert.match(diag.formatStatus(off), /አልተዘጋጀም/);
});

test("smsCheck: ያለ SMS / ልክ ያልሆነ ቁጥር", async () => {
  assert.equal((await diag.smsCheck("!!")).valid, false);
  const found = await diag.smsCheck("djf5t7gtm7"); assert.ok(found.rec); assert.match(diag.formatCheck(found), /ተገኝቷል/);
  const none = await diag.smsCheck("ZZZZZZZZZZ"); assert.equal(none.rec, null); assert.match(diag.formatCheck(none), /በዳታቤዝ የለም/);
});
