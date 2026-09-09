#!/usr/bin/env python3
"""Prepare one atomic, audited operator statement from a private D1 restoration.

This tool never connects to production. Review the private SQL and apply it with
existing owner Wrangler access only after the release/recovery gates pass.
"""

import argparse
import copy
import json
import os
from pathlib import Path
import sqlite3
import time
import unicodedata
import uuid


def rows(db, query, values=()):
    return [dict(row) for row in db.execute(query, values)]


def member_snapshot(db, member_ids):
    marks = ','.join('?' for _ in member_ids)
    members = rows(db, f'SELECT * FROM crew_members WHERE id IN ({marks}) ORDER BY id', member_ids)
    if len(members) != len(set(member_ids)):
        raise ValueError('Every selected member must exist.')
    return {
        'members': members,
        'aliases': rows(db, f'SELECT * FROM member_aliases WHERE member_id IN ({marks}) ORDER BY alias_key', member_ids),
        'allocations': rows(db, f'SELECT * FROM allocation_members WHERE member_id IN ({marks}) ORDER BY allocation_id', member_ids),
    }


def prepare(db, command, args):
    reverses = None
    if command == 'reverse':
        audit = db.execute('SELECT * FROM projection_audit WHERE id = ?', (args.audit,)).fetchone()
        if not audit or not audit['action'].startswith('operator.'):
            raise ValueError('Select an existing operator audit record.')
        if db.execute('SELECT 1 FROM projection_audit WHERE reverses_audit_id = ?', (args.audit,)).fetchone():
            raise ValueError('This operation has already been reversed.')
        return audit['action'], audit['target_id'], json.loads(audit['after_json']), json.loads(audit['before_json']), args.audit
    if command in ('rename', 'privacy', 'merge'):
        member_ids = [args.member] if command != 'merge' else [args.source, args.destination]
        if len(set(member_ids)) != len(member_ids):
            raise ValueError('Merge source and destination must differ.')
        before = member_snapshot(db, member_ids)
        if command == 'merge' and len({row['public_display'] for row in before['members']}) != 1:
            raise ValueError('Merge members must have matching visibility. Review and apply an explicit privacy change first.')
        after = copy.deepcopy(before)
        if command == 'rename':
            name = ' '.join(args.name.split())
            key = unicodedata.normalize('NFKC', name).lower()
            if not 1 <= len(name) <= 30 or key == 'anonymous':
                raise ValueError('Choose a non-Anonymous display name of 1–30 characters.')
            alias = db.execute('SELECT member_id FROM member_aliases WHERE alias_key = ?', (key,)).fetchone()
            if alias and alias['member_id'] != args.member:
                raise ValueError('Name already belongs to another member; no automatic merge.')
            after['members'][0]['display_name'] = name
            if not alias:
                after['aliases'].append({'alias_key': key, 'member_id': args.member, 'display_name': name})
                after['aliases'].sort(key=lambda row: row['alias_key'])
        elif command == 'privacy':
            after['members'][0]['public_display'] = int(args.visibility == 'public')
        else:
            for row in after['members']:
                if row['id'] == args.source:
                    row['public_display'] = 0
            for table in ('aliases', 'allocations'):
                for row in after[table]:
                    if row['member_id'] == args.source:
                        row['member_id'] = args.destination
        return 'operator.member', member_ids[0], before, after, reverses
    if command == 'classify':
        if not db.execute('SELECT 1 FROM beer_entries WHERE id = ?', (args.entry,)).fetchone():
            raise ValueError('Exact entry ID does not exist in this snapshot.')
        evidence = args.evidence.strip()
        if len(evidence) < 12:
            raise ValueError('Provide specific verified evidence, not just a contributor name.')
        found = rows(db, 'SELECT * FROM entry_classification WHERE entry_id = ?', (args.entry,))
        before = {'classification': found[0] if found else None}
        after = {'classification': {'entry_id': args.entry, 'is_system': int(args.kind == 'system'), 'evidence': evidence}}
        return 'operator.classify', args.entry, before, after, reverses
    if command == 'capabilities':
        current = db.execute('SELECT mutations_enabled FROM upgrade_state WHERE id = 1').fetchone()
        if not current:
            raise ValueError('Expanded schema is not installed.')
        return 'operator.capabilities', 'upgrade', {'enabled': current[0]}, {'enabled': int(args.state == 'enabled')}, reverses
    raise ValueError('Unsupported command.')


def sql_literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def statement(action, target, before, after, reverses, actor, reason):
    values = [str(uuid.uuid4()), action, target, actor, reason,
              json.dumps(before, separators=(',', ':'), ensure_ascii=False),
              json.dumps(after, separators=(',', ':'), ensure_ascii=False),
              str(int(time.time() * 1000)), reverses]
    return ('INSERT INTO projection_audit '
            '(id,action,target_id,actor,reason,before_json,after_json,created_at,reverses_audit_id) VALUES ('
            + ','.join(sql_literal(value) for value in values) + ');\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path, help='Private restored SQLite database; read only')
    parser.add_argument('--output', required=True, type=Path, help='New private SQL file outside Git')
    parser.add_argument('--actor', required=True, help='Operator attribution; never a credential')
    parser.add_argument('--reason', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    rename = sub.add_parser('rename'); rename.add_argument('--member', required=True); rename.add_argument('--name', required=True)
    privacy = sub.add_parser('privacy'); privacy.add_argument('--member', required=True); privacy.add_argument('--visibility', choices=['public', 'hidden'], required=True)
    merge = sub.add_parser('merge'); merge.add_argument('--source', required=True); merge.add_argument('--destination', required=True)
    classify = sub.add_parser('classify'); classify.add_argument('--entry', required=True); classify.add_argument('--kind', choices=['system', 'community'], required=True); classify.add_argument('--evidence', required=True)
    gate = sub.add_parser('capabilities'); gate.add_argument('--state', choices=['enabled', 'disabled'], required=True)
    reverse = sub.add_parser('reverse'); reverse.add_argument('--audit', required=True)
    args = parser.parse_args()
    if not args.actor.strip() or len(args.reason.strip()) < 4:
        parser.error('Operator attribution and a meaningful reason are required.')
    output = args.output.resolve()
    if any((parent / '.git').exists() for parent in [output.parent, *output.parents]):
        parser.error('Operator plans contain private data and must stay outside Git.')
    try:
        with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            db.execute('BEGIN')
            plan = prepare(db, args.command, args)
        sql = statement(*plan, args.actor.strip(), args.reason.strip())
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as handle:
            handle.write(sql)
    except (ValueError, sqlite3.Error, OSError) as error:
        parser.exit(1, f'Operator plan not created: {type(error).__name__}. Review the private snapshot and arguments.\n')
    print('Private guarded operator statement prepared. No remote changes made.')


if __name__ == '__main__':
    main()
