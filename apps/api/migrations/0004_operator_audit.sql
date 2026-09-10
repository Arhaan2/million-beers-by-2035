-- Owner-only operations are ONE audited INSERT. The trigger makes its checks
-- and projection updates atomic even when executed through the D1 owner CLI.
-- No HTTP route may accept operator.* audit actions.
CREATE TRIGGER operator_member_apply AFTER INSERT ON projection_audit
WHEN NEW.action = 'operator.member'
BEGIN
  SELECT (CASE WHEN NOT json_valid(NEW.before_json) OR NOT json_valid(NEW.after_json)
    OR json_array_length(NEW.before_json, '$.members') NOT BETWEEN 1 AND 2
    OR json_array_length(NEW.before_json, '$.members') <> json_array_length(NEW.after_json, '$.members')
    OR json_array_length(NEW.before_json, '$.allocations') <> json_array_length(NEW.after_json, '$.allocations')
    THEN RAISE(ABORT, 'invalid_operator_plan') END);
  -- Full affected-member snapshots reject intervening names, privacy changes,
  -- alias moves, and even newly recorded allocations. Reversal uses the same
  -- guard, so it cannot silently overwrite work after an administrative change.
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.before_json, '$.members') b
    LEFT JOIN crew_members m ON m.id = json_extract(b.value, '$.id')
    WHERE m.id IS NULL OR m.display_name IS NOT json_extract(b.value, '$.display_name')
      OR m.public_display IS NOT json_extract(b.value, '$.public_display')
      OR m.created_at IS NOT json_extract(b.value, '$.created_at')
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.after_json, '$.members') a
    WHERE NOT EXISTS (SELECT 1 FROM json_each(NEW.before_json, '$.members') b
      WHERE json_extract(a.value, '$.id') = json_extract(b.value, '$.id')
        AND json_extract(a.value, '$.created_at') = json_extract(b.value, '$.created_at'))
  ) THEN RAISE(ABORT, 'operator_snapshot_changed') END);
  SELECT (CASE WHEN
    (SELECT COUNT(*) FROM member_aliases WHERE member_id IN (
      SELECT json_extract(value, '$.id') FROM json_each(NEW.before_json, '$.members')))
      <> json_array_length(NEW.before_json, '$.aliases')
    OR (SELECT COUNT(*) FROM allocation_members WHERE member_id IN (
      SELECT json_extract(value, '$.id') FROM json_each(NEW.before_json, '$.members')))
      <> json_array_length(NEW.before_json, '$.allocations')
    OR EXISTS (SELECT 1 FROM json_each(NEW.before_json, '$.aliases') b
      LEFT JOIN member_aliases a ON a.alias_key = json_extract(b.value, '$.alias_key')
      WHERE a.alias_key IS NULL OR a.member_id IS NOT json_extract(b.value, '$.member_id')
        OR a.display_name IS NOT json_extract(b.value, '$.display_name'))
    OR EXISTS (SELECT 1 FROM json_each(NEW.before_json, '$.allocations') b
      LEFT JOIN allocation_members a ON a.allocation_id = json_extract(b.value, '$.allocation_id')
      WHERE a.allocation_id IS NULL OR a.member_id IS NOT json_extract(b.value, '$.member_id')
        OR a.entry_id IS NOT json_extract(b.value, '$.entry_id'))
    THEN RAISE(ABORT, 'operator_snapshot_changed') END);
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.after_json, '$.aliases') a
    WHERE json_extract(a.value, '$.member_id') NOT IN (
      SELECT json_extract(value, '$.id') FROM json_each(NEW.before_json, '$.members'))
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.after_json, '$.allocations') a
    WHERE json_extract(a.value, '$.member_id') NOT IN (
      SELECT json_extract(value, '$.id') FROM json_each(NEW.before_json, '$.members'))
    OR NOT EXISTS (SELECT 1 FROM json_each(NEW.before_json, '$.allocations') b
      WHERE json_extract(a.value, '$.allocation_id') = json_extract(b.value, '$.allocation_id')
        AND json_extract(a.value, '$.entry_id') = json_extract(b.value, '$.entry_id'))
  ) THEN RAISE(ABORT, 'invalid_operator_plan') END);
  -- A merge must not silently widen visibility of a hidden label or alias.
  -- A separate explicit privacy operation must establish matching preferences.
  SELECT (CASE WHEN (
    SELECT COUNT(DISTINCT json_extract(value, '$.public_display'))
    FROM json_each(NEW.before_json, '$.members')
  ) > 1 AND (
    EXISTS (SELECT 1 FROM json_each(NEW.after_json, '$.allocations') a
      JOIN json_each(NEW.before_json, '$.allocations') b
      ON json_extract(a.value, '$.allocation_id') = json_extract(b.value, '$.allocation_id')
      WHERE json_extract(a.value, '$.member_id') IS NOT json_extract(b.value, '$.member_id'))
    OR EXISTS (SELECT 1 FROM json_each(NEW.after_json, '$.aliases') a
      JOIN json_each(NEW.before_json, '$.aliases') b
      ON json_extract(a.value, '$.alias_key') = json_extract(b.value, '$.alias_key')
      WHERE json_extract(a.value, '$.member_id') IS NOT json_extract(b.value, '$.member_id'))
  ) AND NOT EXISTS (
    SELECT 1 FROM projection_audit original
    WHERE original.id = NEW.reverses_audit_id AND original.action = NEW.action
      AND original.target_id = NEW.target_id
      AND json(original.after_json) = json(NEW.before_json)
      AND json(original.before_json) = json(NEW.after_json)
  ) THEN RAISE(ABORT, 'operator_visibility_mismatch') END);
  UPDATE crew_members SET
    display_name = (SELECT json_extract(value, '$.display_name') FROM json_each(NEW.after_json, '$.members') WHERE json_extract(value, '$.id') = crew_members.id),
    public_display = (SELECT json_extract(value, '$.public_display') FROM json_each(NEW.after_json, '$.members') WHERE json_extract(value, '$.id') = crew_members.id)
  WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(NEW.after_json, '$.members'));
  DELETE FROM member_aliases WHERE member_id IN (
    SELECT json_extract(value, '$.id') FROM json_each(NEW.before_json, '$.members'));
  INSERT INTO member_aliases(alias_key, member_id, display_name)
  SELECT json_extract(value, '$.alias_key'), json_extract(value, '$.member_id'), json_extract(value, '$.display_name')
  FROM json_each(NEW.after_json, '$.aliases');
  UPDATE allocation_members SET member_id = (
    SELECT json_extract(value, '$.member_id') FROM json_each(NEW.after_json, '$.allocations')
    WHERE json_extract(value, '$.allocation_id') = allocation_members.allocation_id)
  WHERE allocation_id IN (SELECT json_extract(value, '$.allocation_id') FROM json_each(NEW.after_json, '$.allocations'));
END;

CREATE TRIGGER operator_classification_apply AFTER INSERT ON projection_audit
WHEN NEW.action = 'operator.classify'
BEGIN
  SELECT (CASE WHEN NOT json_valid(NEW.before_json) OR NOT json_valid(NEW.after_json)
    OR NOT EXISTS (SELECT 1 FROM beer_entries WHERE id = NEW.target_id)
    OR (json_extract(NEW.before_json, '$.classification') IS NULL
      AND EXISTS (SELECT 1 FROM entry_classification WHERE entry_id = NEW.target_id))
    OR (json_extract(NEW.before_json, '$.classification') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM entry_classification WHERE entry_id = NEW.target_id
        AND entry_id = json_extract(NEW.before_json, '$.classification.entry_id')
        AND is_system = json_extract(NEW.before_json, '$.classification.is_system')
        AND evidence = json_extract(NEW.before_json, '$.classification.evidence')))
    OR (json_extract(NEW.after_json, '$.classification') IS NOT NULL
      AND json_extract(NEW.after_json, '$.classification.entry_id') IS NOT NEW.target_id)
    THEN RAISE(ABORT, 'operator_snapshot_changed') END);
  DELETE FROM entry_classification WHERE entry_id = NEW.target_id;
  INSERT INTO entry_classification(entry_id, is_system, evidence)
  SELECT NEW.target_id, json_extract(NEW.after_json, '$.classification.is_system'), json_extract(NEW.after_json, '$.classification.evidence')
  WHERE json_extract(NEW.after_json, '$.classification') IS NOT NULL;
END;

CREATE TRIGGER operator_capabilities_apply AFTER INSERT ON projection_audit
WHEN NEW.action = 'operator.capabilities'
BEGIN
  SELECT (CASE WHEN NOT json_valid(NEW.before_json) OR NOT json_valid(NEW.after_json)
    OR json_extract(NEW.after_json, '$.enabled') NOT IN (0, 1)
    OR (SELECT mutations_enabled FROM upgrade_state WHERE id = 1) IS NOT json_extract(NEW.before_json, '$.enabled')
    THEN RAISE(ABORT, 'operator_snapshot_changed') END);
  UPDATE upgrade_state SET mutations_enabled = json_extract(NEW.after_json, '$.enabled'), revision = revision + 1 WHERE id = 1;
END;

CREATE UNIQUE INDEX idx_operator_single_reversal ON projection_audit(reverses_audit_id)
WHERE reverses_audit_id IS NOT NULL;
