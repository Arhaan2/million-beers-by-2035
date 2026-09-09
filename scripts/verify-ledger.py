#!/usr/bin/env python3
"""Verify a private SQLite restoration and checkpoint immutable ledger records.

This tool never connects to a remote service or writes to the input database.
Manifests contain operational IDs and must stay outside the repository.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys


ROOT = Path(__file__).resolve().parents[1]
IMMUTABLE = {
    "beer_entries": (
        "id", "idempotency_key", "total_amount", "note", "allocation_count",
        "created_at", "local_day", "session_fingerprint",
    ),
    "beer_events": (
        "id", "idempotency_key", "amount", "contributor", "contributor_key",
        "note", "created_at", "local_day", "session_fingerprint", "entry_id",
        "allocation_index",
    ),
}


class IntegrityError(Exception):
    """An invariant failed; messages deliberately do not contain row contents."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def require(condition, message):
    if not condition:
        raise IntegrityError(message)


def rows(connection, query):
    return [dict(row) for row in connection.execute(query)]


def snapshot(database_path, challenge):
    """Read all assertions and hashes within one consistent SQLite transaction."""
    path = Path(database_path).resolve(strict=True)
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        require(connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok",
                "SQLite integrity_check failed")
        tables = {row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'")}
        require(set(IMMUTABLE) <= tables, "Required ledger tables are missing")
        ledger = {}
        for table, fields in IMMUTABLE.items():
            ledger[table] = rows(connection, f"SELECT {','.join(fields)} FROM {table} ORDER BY id")
        parents = {row["id"]: row for row in ledger["beer_entries"]}
        children = ledger["beer_events"]
        allocations = {identifier: [] for identifier in parents}
        contributor_expected = {}
        daily_expected = {}
        for child in children:
            require(child["entry_id"] in parents, "An allocation has no parent")
            allocations[child["entry_id"]].append(child)
            contributor = contributor_expected.setdefault(child["contributor_key"], [0, 0])
            contributor[0] += child["amount"]
            contributor[1] += 1
            daily = daily_expected.setdefault(child["local_day"], [0, 0, 0])
            daily[0] += child["amount"]
            daily[1] += 1
        for identifier, parent in parents.items():
            group = allocations[identifier]
            require(len(group) == parent["allocation_count"], "A parent allocation count differs")
            require(sum(child["amount"] for child in group) == parent["total_amount"],
                    "A parent total differs from its allocations")
            require(sorted(child["allocation_index"] for child in group) == list(range(len(group))),
                    "An allocation sequence is missing, repeated, or non-contiguous")
            require(all(child["created_at"] == parent["created_at"] and
                        child["local_day"] == parent["local_day"] for child in group),
                    "A parent recording time differs from its allocations")
            daily_expected.setdefault(parent["local_day"], [0, 0, 0])[2] += 1
        state_rows = rows(connection, "SELECT id,total,event_count,entry_count FROM challenge_state")
        require(len(state_rows) == 1 and state_rows[0]["id"] == 1,
                "Challenge state is missing or not unique")
        state = state_rows[0]
        total = sum(parent["total_amount"] for parent in parents.values())
        require(state["total"] == total == sum(child["amount"] for child in children),
                "Canonical total, parent sum, and allocation sum do not reconcile")
        require(state["entry_count"] == len(parents) and state["event_count"] == len(children),
                "Stored challenge counts do not reconcile")
        contributors = rows(connection, "SELECT contributor_key,net_total,event_count FROM contributor_totals ORDER BY contributor_key")
        require({row["contributor_key"]: [row["net_total"], row["event_count"]]
                 for row in contributors} == contributor_expected,
                "Contributor aggregates do not reconcile")
        daily = rows(connection, "SELECT local_day,net_total,event_count,entry_count FROM daily_totals ORDER BY local_day")
        require({row["local_day"]: [row["net_total"], row["event_count"], row["entry_count"]]
                 for row in daily} == daily_expected,
                "Recorded-day aggregates do not reconcile")
        migrations = rows(connection, "SELECT * FROM d1_migrations ORDER BY id") if "d1_migrations" in tables else []
        result = {
            "version": 1,
            "challenge": challenge,
            "counts": {"total": total, "entries": len(parents), "allocations": len(children)},
            "immutableFields": {table: list(fields) for table, fields in IMMUTABLE.items()},
            "immutableHashes": {
                table: {row["id"]: digest(row) for row in table_rows}
                for table, table_rows in ledger.items()
            },
            "contributorAggregates": contributors,
            "recordedDayAggregates": daily,
            "relationshipsHash": digest([
                [row["id"], row["entry_id"], row["allocation_index"]] for row in children
            ]),
            "migrations": migrations,
        }
        connection.rollback()
        return result
    finally:
        connection.close()


def compare(before, after):
    require(before.get("version") == after["version"] == 1, "Unsupported manifest version")
    require(before.get("challenge") == after["challenge"], "Challenge configuration changed")
    require(before.get("immutableFields") == after["immutableFields"], "Immutable field definition changed")
    appended = {}
    for table in IMMUTABLE:
        old = before["immutableHashes"][table]
        new = after["immutableHashes"][table]
        require(all(identifier in new for identifier in old), f"Checkpointed {table} rows are missing")
        require(all(new[identifier] == hash_value for identifier, hash_value in old.items()),
                f"Checkpointed immutable {table} fields changed")
        appended[table] = len(new) - len(old)
    old_migrations = {canonical(row) for row in before["migrations"]}
    new_migrations = {canonical(row) for row in after["migrations"]}
    require(old_migrations <= new_migrations, "Applied migration records changed or disappeared")
    return {"appendedEntries": appended["beer_entries"],
            "appendedAllocations": appended["beer_events"],
            "totalChange": after["counts"]["total"] - before["counts"]["total"]}


def write_private(path, value):
    destination = Path(path).expanduser().resolve()
    require(not destination.is_relative_to(ROOT), "Private manifests must be outside the repository")
    require(destination.parent.is_dir(), "Manifest destination directory does not exist")
    # Exclusive creation prevents overwriting a checkpoint or following a symlink.
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, indent=2, ensure_ascii=False)
        output.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", help="Private restored local SQLite database; never a remote DB")
    parser.add_argument("--challenge", required=True, help="JSON file containing the four challenge configuration values")
    parser.add_argument("--checkpoint", help="Compare an earlier private JSON checkpoint, allowing appended records")
    parser.add_argument("--output", help="Create a private manifest outside the repository (never overwrite)")
    arguments = parser.parse_args()
    try:
        challenge = json.loads(Path(arguments.challenge).read_text(encoding="utf-8"))
        expected = {"CHALLENGE_TARGET", "CHALLENGE_START_ISO", "CHALLENGE_DEADLINE_ISO", "CHALLENGE_TIMEZONE"}
        require(isinstance(challenge, dict) and set(challenge) == expected,
                "Challenge JSON must contain exactly the four CHALLENGE_* configuration values")
        result = snapshot(arguments.database, challenge)
        summary = {"verified": True, **result["counts"]}
        if arguments.checkpoint:
            before = json.loads(Path(arguments.checkpoint).read_text(encoding="utf-8"))
            summary.update(compare(before, result))
        if arguments.output:
            write_private(arguments.output, result)
        print(json.dumps(summary, sort_keys=True))
        return 0
    except (IntegrityError, OSError, sqlite3.Error, ValueError, KeyError, TypeError) as error:
        # SQLite errors and paths can contain sensitive operational details.
        message = str(error) if isinstance(error, IntegrityError) else type(error).__name__
        print(json.dumps({"verified": False, "error": message}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
