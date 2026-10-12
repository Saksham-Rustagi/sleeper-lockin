import { test } from "node:test";
import assert from "node:assert/strict";
import { irEligible } from "../lib/live/ir";
import { irMessages } from "../scripts/notify";

const LEAGUE = { reserve_allow_out: 1, reserve_allow_sus: 1, reserve_allow_dnr: 1, reserve_allow_dtd: 0, reserve_allow_doubtful: 0, reserve_allow_na: 0, reserve_allow_cov: 0 };
test("IR eligibility follows the league's settings", () => {
  assert.equal(irEligible("Out", LEAGUE), true);
  assert.equal(irEligible("Sus", LEAGUE), true);
  assert.equal(irEligible("DTD", LEAGUE), false);
  assert.equal(irEligible("Doubtful", LEAGUE), false);
  assert.equal(irEligible("Questionable", LEAGUE), false);
  assert.equal(irEligible(null, LEAGUE), false, "healthy players can't sit on IR");
  assert.equal(irEligible("Doubtful", { ...LEAGUE, reserve_allow_doubtful: 1 }), true);
});
test("IR reminders: urgent activation names who to drop; plain 'when he returns' plans stay quiet until urgent", () => {
  const msgs = irMessages([
    { kind: "activate_drop", urgent: true, key: "activate|1698|2281", title: "Activate Brandon Ingram and drop Santi Aldama", detail: "x", dropOptions: [{ pid: "2281", name: "Santi Aldama", pos: "PF", loss: 0, protected: false, reason: null, dynastyAdp: 130 }, { pid: "2009", name: "Kevin Porter", pos: "PG", loss: 0.2, protected: false, reason: null, dynastyAdp: 144 }] },
    { kind: "prepare", urgent: false, key: "prep|2233|x", title: "When Jusuf Nurkić comes back", detail: "y" },
    { kind: "move_to_ir", urgent: false, key: "toir|1934", title: "Move Isaiah Hartenstein (Out) to IR", detail: "z" },
  ]);
  assert.equal(msgs.length, 2);
  assert.match(msgs[0].title, /⚠️ Activate Brandon Ingram and drop Santi Aldama/);
  assert.match(msgs[0].body, /Other drop options: Kevin Porter/);
  assert.match(msgs[1].title, /🏥 Move Isaiah Hartenstein \(Out\) to IR/);
});
