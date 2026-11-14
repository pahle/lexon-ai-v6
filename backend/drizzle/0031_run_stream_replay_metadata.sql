ALTER TABLE app.ai_runs
  ADD COLUMN stream_generation bigint NOT NULL DEFAULT 0 CHECK (stream_generation >= 0),
  ADD COLUMN stream_snapshot_generation bigint NOT NULL DEFAULT 0 CHECK (stream_snapshot_generation >= 0),
  ADD COLUMN stream_event_id text,
  ADD COLUMN stream_attempt_id uuid,
  ADD COLUMN stream_revision integer NOT NULL DEFAULT 0 CHECK (stream_revision >= 0),
  ADD COLUMN stream_resumable boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT ai_runs_stream_event_id_format CHECK
    (stream_event_id IS NULL OR stream_event_id ~ '^[0-9]+-[0-9]+$'),
  ADD CONSTRAINT ai_runs_stream_resumable_pair CHECK
    (NOT stream_resumable OR (stream_snapshot_generation > 0 AND stream_event_id IS NOT NULL AND stream_attempt_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE app.ai_checkpoints
  ADD COLUMN stream_generation bigint NOT NULL DEFAULT 0 CHECK (stream_generation >= 0),
  ADD COLUMN stream_event_id text,
  ADD COLUMN stream_revision integer NOT NULL DEFAULT 0 CHECK (stream_revision >= 0),
  ADD COLUMN stream_resumable boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT ai_checkpoints_stream_event_id_format CHECK
    (stream_event_id IS NULL OR stream_event_id ~ '^[0-9]+-[0-9]+$'),
  ADD CONSTRAINT ai_checkpoints_stream_resumable_pair CHECK
    (NOT stream_resumable OR (stream_generation > 0 AND stream_event_id IS NOT NULL));
--> statement-breakpoint
DROP TRIGGER ai_runs_chat_write_fence ON app.ai_runs;
CREATE TRIGGER ai_runs_chat_write_fence BEFORE UPDATE OF input_text,resolved_config,partial_output,final_output,reasoning_summary,reasoning_duration_ms,stream_generation,stream_snapshot_generation,stream_event_id,stream_attempt_id,stream_revision,stream_resumable ON app.ai_runs
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();
--> statement-breakpoint
DROP TRIGGER ai_checkpoints_chat_write_fence ON app.ai_checkpoints;
CREATE TRIGGER ai_checkpoints_chat_write_fence BEFORE INSERT OR UPDATE OF attempt_id,fence,text,reasoning_summary,reasoning_duration_ms,stream_generation,stream_event_id,stream_revision,stream_resumable ON app.ai_checkpoints
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();
