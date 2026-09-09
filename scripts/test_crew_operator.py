"""Operator transaction checks against synthetic local SQLite only."""

import copy
import importlib.util
from pathlib import Path
import sqlite3
from types import SimpleNamespace
import unittest

import test_verify_ledger as fixtures


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("crew_operator", ROOT / "scripts/crew-operator.py")
operator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operator)


class CrewOperatorTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.LedgerVerifierTests()
        self.fixture.setUp()
        self.db = self.fixture.connection
        self.db.row_factory = sqlite3.Row
        for migration in ["0003_crew_upgrade.sql", "0004_operator_audit.sql"]:
            self.db.executescript((ROOT / "apps/api/migrations" / migration).read_text())
        self.before = self.fixture.snapshot()
        self.member = "member-original-0"
        self.other = "member-original-1"

    def tearDown(self):
        self.fixture.tearDown()

    def plan(self, command, **values):
        return operator.prepare(self.db, command, SimpleNamespace(**values))

    def apply(self, plan):
        cursor = self.db.execute(operator.statement(*plan, "synthetic-operator", "Synthetic verification"))
        identifier = self.db.execute("SELECT id FROM projection_audit WHERE rowid=?", (cursor.lastrowid,)).fetchone()[0]
        self.db.commit()
        return identifier

    def preserved(self):
        self.assertEqual(fixtures.verifier.compare(self.before, self.fixture.snapshot()), {
            "appendedEntries": 0, "appendedAllocations": 0, "totalChange": 0,
        })

    def test_rename_is_audited_reversible_and_keeps_original_alias_and_ledger(self):
        identifier = self.apply(self.plan("rename", member=self.member, name="Renamed Synthetic"))
        self.assertEqual(self.db.execute("SELECT display_name FROM crew_members WHERE id=?", (self.member,)).fetchone()[0], "Renamed Synthetic")
        self.assertEqual(self.db.execute("SELECT count(*) FROM member_aliases WHERE member_id=?", (self.member,)).fetchone()[0], 2)
        self.preserved()
        self.apply(self.plan("reverse", audit=identifier))
        self.assertEqual(self.db.execute("SELECT display_name FROM crew_members WHERE id=?", (self.member,)).fetchone()[0], "Synthetic 0")
        self.preserved()
        with self.assertRaisesRegex(ValueError, "already been reversed"):
            self.plan("reverse", audit=identifier)

    def test_stale_rename_after_new_allocation_is_rejected_atomically(self):
        plan = self.plan("rename", member=self.member, name="Renamed Synthetic")
        self.fixture.append("intervening", [1], 3000)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "operator_snapshot_changed"):
            self.apply(plan)
        self.db.rollback()
        self.assertEqual(self.db.execute("SELECT count(*) FROM projection_audit").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT display_name FROM crew_members WHERE id=?", (self.member,)).fetchone()[0], "Synthetic 0")

    def test_alias_collision_aborts_rename_before_writing(self):
        with self.assertRaisesRegex(ValueError, "another member"):
            self.plan("rename", member=self.member, name="SYNTHETIC 1")
        self.preserved()

    def test_merge_moves_projection_only_and_can_reverse_without_losing_allocation_order(self):
        identifier = self.apply(self.plan("merge", source=self.member, destination=self.other))
        self.assertEqual(self.db.execute("SELECT count(*) FROM allocation_members WHERE member_id=?", (self.other,)).fetchone()[0], 2)
        self.assertEqual(self.db.execute("SELECT net_total FROM member_activity WHERE member_id=?", (self.other,)).fetchone()[0], 5)
        self.preserved()
        self.apply(self.plan("reverse", audit=identifier))
        self.assertEqual(self.db.execute("SELECT count(*) FROM allocation_members WHERE member_id=?", (self.member,)).fetchone()[0], 1)
        self.preserved()

    def test_merge_refuses_to_publish_hidden_source_through_public_destination(self):
        self.apply(self.plan("privacy", member=self.member, visibility="hidden"))
        with self.assertRaisesRegex(ValueError, "matching visibility"):
            self.plan("merge", source=self.member, destination=self.other)
        # The same guard exists in the transaction, even for a malformed plan.
        before = operator.member_snapshot(self.db, [self.member, self.other])
        after = copy.deepcopy(before)
        for table in ("aliases", "allocations"):
            for row in after[table]:
                row["member_id"] = self.other
        with self.assertRaisesRegex(sqlite3.IntegrityError, "operator_visibility_mismatch"):
            self.apply(("operator.member", self.member, before, after, None))
        self.db.rollback()
        self.preserved()

    def test_merge_reversal_refuses_intervening_member_activity(self):
        identifier = self.apply(self.plan("merge", source=self.member, destination=self.other))
        self.fixture.append("after-merge", [1], 3000)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "operator_snapshot_changed"):
            self.apply(self.plan("reverse", audit=identifier))
        self.db.rollback()
        self.assertEqual(self.db.execute("SELECT count(*) FROM projection_audit WHERE reverses_audit_id=?", (identifier,)).fetchone()[0], 0)

    def test_exact_id_classification_changes_community_projection_not_raw_totals(self):
        identifier = self.apply(self.plan("classify", entry="original", kind="system", evidence="Synthetic exact-ID evidence only"))
        self.assertEqual(self.db.execute("SELECT sum(net_total) FROM community_member_activity").fetchone()[0], 0)
        self.preserved()
        self.apply(self.plan("reverse", audit=identifier))
        self.assertEqual(self.db.execute("SELECT sum(net_total) FROM community_member_activity").fetchone()[0], 5)
        self.preserved()
        with self.assertRaisesRegex(ValueError, "Exact entry ID"):
            self.plan("classify", entry="missing", kind="system", evidence="Synthetic exact-ID evidence only")

    def test_capability_switch_is_guarded_audited_and_reversible(self):
        enable = self.plan("capabilities", state="enabled")
        identifier = self.apply(enable)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "operator_snapshot_changed"):
            self.apply(enable)
        self.db.rollback()
        self.assertEqual(self.db.execute("SELECT mutations_enabled FROM upgrade_state").fetchone()[0], 1)
        self.apply(self.plan("reverse", audit=identifier))
        self.assertEqual(self.db.execute("SELECT mutations_enabled FROM upgrade_state").fetchone()[0], 0)
        self.preserved()


if __name__ == "__main__":
    unittest.main()
