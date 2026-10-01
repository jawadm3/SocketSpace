-- The moderation audit log is append-only (requirement ADMIN-05, security.md "Repudiation").
--
-- * UPDATE is always refused: a recorded action can never be rewritten.
-- * DELETE is refused unless the row is older than the one-year retention period, so the daily
--   retention job can remove expired rows but nobody can remove recent ones.
-- * TRUNCATE is refused as well (it bypasses row-level triggers).
--
-- Someone with full database-owner rights could still drop the trigger; this protects against
-- mistakes and misuse through the application, which is what an application audit log is for.

CREATE OR REPLACE FUNCTION moderation_action_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'moderation_action is append-only: UPDATE is not allowed'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.created_at > now() - interval '365 days' THEN
      RAISE EXCEPTION 'moderation_action is append-only: rows younger than 365 days cannot be deleted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'moderation_action is append-only: TRUNCATE is not allowed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER moderation_action_no_update
  BEFORE UPDATE ON moderation_action
  FOR EACH ROW EXECUTE FUNCTION moderation_action_append_only();
--> statement-breakpoint
CREATE TRIGGER moderation_action_no_delete
  BEFORE DELETE ON moderation_action
  FOR EACH ROW EXECUTE FUNCTION moderation_action_append_only();
--> statement-breakpoint
CREATE TRIGGER moderation_action_no_truncate
  BEFORE TRUNCATE ON moderation_action
  FOR EACH STATEMENT EXECUTE FUNCTION moderation_action_append_only();
