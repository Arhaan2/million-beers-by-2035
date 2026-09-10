"""Synthetic-only regression checks for the private recovery verifier."""

import importlib.util
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verify_ledger", ROOT / "scripts/verify-ledger.py")
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


class LedgerVerifierTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="beer-verifier-synthetic-")
        self.database = Path(self.directory.name) / "fixture.sqlite"
        self.connection = sqlite3.connect(self.database)
        for filename in ["0001_initial.sql", "0002_group_entries.sql"]:
            self.connection.executescript((ROOT / "apps/api/migrations" / filename).read_text())
        self.connection.executescript("""
            CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
            INSERT INTO d1_migrations VALUES (1, '0001_initial.sql', 'synthetic'), (2, '0002_group_entries.sql', 'synthetic');
        """)
        self.append("original", [3, 2], 2000)
        self.challenge = {"CHALLENGE_TARGET": "1000000", "CHALLENGE_START_ISO": "2026-07-24T00:00:00-07:00",
                          "CHALLENGE_DEADLINE_ISO": "2035-01-01T00:00:00-08:00", "CHALLENGE_TIMEZONE": "America/Los_Angeles"}

    def tearDown(self):
        self.connection.close()
        self.directory.cleanup()

    def append(self, identifier, amounts, recorded_at):
        total = sum(amounts)
        self.connection.execute("INSERT INTO beer_entries VALUES (?, ?, ?, 'Synthetic note', ?, ?, '2026-09-09', 'synthetic')",
                                (identifier, f"key-{identifier}", total, len(amounts), recorded_at))
        for index, amount in enumerate(amounts):
            label = f"Synthetic {index}"
            key = label.lower()
            self.connection.execute("INSERT INTO beer_events VALUES (?, ?, ?, ?, ?, 'Synthetic note', ?, '2026-09-09', 'synthetic', ?, ?)",
                                    (f"{identifier}-{index}", f"key-{identifier}-{index}", amount, label, key, recorded_at, identifier, index))
            self.connection.execute("""INSERT INTO contributor_totals VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(contributor_key) DO UPDATE SET net_total=net_total+excluded.net_total,
                event_count=event_count+1,updated_at=excluded.updated_at""", (key, label, amount, recorded_at))
        self.connection.execute("UPDATE challenge_state SET total=total+?,event_count=event_count+?,entry_count=entry_count+1,updated_at=?", (total, len(amounts), recorded_at))
        self.connection.execute("""INSERT INTO daily_totals VALUES ('2026-09-09', ?, ?, ?, 1)
            ON CONFLICT(local_day) DO UPDATE SET net_total=net_total+excluded.net_total,
            event_count=event_count+excluded.event_count,entry_count=entry_count+1,updated_at=excluded.updated_at""", (total, len(amounts), recorded_at))
        self.connection.commit()

    def snapshot(self):
        return verifier.snapshot(self.database, self.challenge)

    def test_consistent_snapshot_reconciles_every_aggregate(self):
        captured = self.snapshot()
        self.assertEqual(captured["counts"], {"total": 5, "entries": 1, "allocations": 2})
        self.assertEqual(len(captured["immutableHashes"]["beer_events"]), 2)

    def test_append_and_correction_allow_equal_or_earlier_wall_clock_times(self):
        before = self.snapshot()
        self.append("later-positive", [1], 2000)
        self.append("later-correction", [-2], 1000)
        self.assertEqual(verifier.compare(before, self.snapshot()), {
            "appendedEntries": 2, "appendedAllocations": 2, "totalChange": -1,
        })

    def test_changed_source_note_is_detected_without_printing_content(self):
        before = self.snapshot()
        self.connection.execute("UPDATE beer_events SET note='sensitive replacement'")
        self.connection.commit()
        with self.assertRaisesRegex(verifier.IntegrityError, "immutable beer_events fields changed"):
            verifier.compare(before, self.snapshot())

    def test_changed_allocation_order_is_detected_even_when_totals_match(self):
        before = self.snapshot()
        self.connection.execute("UPDATE beer_events SET allocation_index=allocation_index+10")
        self.connection.execute("UPDATE beer_events SET allocation_index=11-allocation_index")
        self.connection.commit()
        with self.assertRaisesRegex(verifier.IntegrityError, "immutable beer_events fields changed"):
            verifier.compare(before, self.snapshot())

    def test_missing_checkpoint_rows_are_detected_after_consistent_rebuild(self):
        before = self.snapshot()
        self.connection.executescript("""
            DELETE FROM beer_events; DELETE FROM beer_entries; DELETE FROM contributor_totals;
            DELETE FROM daily_totals; UPDATE challenge_state SET total=0,event_count=0,entry_count=0;
        """)
        with self.assertRaisesRegex(verifier.IntegrityError, "rows are missing"):
            verifier.compare(before, self.snapshot())

    def test_bad_contributor_aggregate_is_detected(self):
        self.connection.execute("UPDATE contributor_totals SET net_total=net_total+1")
        self.connection.commit()
        with self.assertRaisesRegex(verifier.IntegrityError, "Contributor aggregates"):
            self.snapshot()

    def test_bad_parent_amount_is_detected(self):
        self.connection.execute("UPDATE beer_entries SET total_amount=4")
        self.connection.commit()
        with self.assertRaisesRegex(verifier.IntegrityError, "parent total"):
            self.snapshot()

    def test_additive_migration_records_allowed_old_records_immutable(self):
        before = self.snapshot()
        self.connection.execute("INSERT INTO d1_migrations VALUES (3,'0003_synthetic.sql','synthetic')")
        self.connection.commit()
        verifier.compare(before, self.snapshot())
        self.connection.execute("UPDATE d1_migrations SET name='rewritten' WHERE id=1")
        self.connection.commit()
        with self.assertRaisesRegex(verifier.IntegrityError, "Applied migration records"):
            verifier.compare(before, self.snapshot())

    def test_manifest_refuses_repository_and_overwrite_and_is_private(self):
        with self.assertRaisesRegex(verifier.IntegrityError, "outside the repository"):
            verifier.write_private(ROOT / "private-manifest.json", {})
        path = Path(self.directory.name) / "manifest.json"
        verifier.write_private(path, self.snapshot())
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            verifier.write_private(path, {})


if __name__ == "__main__":
    unittest.main()
