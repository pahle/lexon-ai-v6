ALTER TABLE app.ai_runs
  ADD COLUMN reasoning_summary text,
  ADD COLUMN reasoning_duration_ms integer,
  ADD CONSTRAINT ai_runs_reasoning_summary_bytes CHECK
    (reasoning_summary IS NULL OR octet_length(reasoning_summary) <= 16384),
  ADD CONSTRAINT ai_runs_reasoning_duration_nonnegative CHECK
    (reasoning_duration_ms IS NULL OR reasoning_duration_ms >= 0);
--> statement-breakpoint
ALTER TABLE app.ai_checkpoints
  ADD COLUMN reasoning_summary text,
  ADD COLUMN reasoning_duration_ms integer,
  ADD CONSTRAINT ai_checkpoints_reasoning_summary_bytes CHECK
    (reasoning_summary IS NULL OR octet_length(reasoning_summary) <= 16384),
  ADD CONSTRAINT ai_checkpoints_reasoning_duration_nonnegative CHECK
    (reasoning_duration_ms IS NULL OR reasoning_duration_ms >= 0);
--> statement-breakpoint
DROP TRIGGER ai_runs_chat_write_fence ON app.ai_runs;
CREATE TRIGGER ai_runs_chat_write_fence BEFORE UPDATE OF input_text,resolved_config,partial_output,final_output,reasoning_summary,reasoning_duration_ms ON app.ai_runs
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();
--> statement-breakpoint
DROP TRIGGER ai_checkpoints_chat_write_fence ON app.ai_checkpoints;
CREATE TRIGGER ai_checkpoints_chat_write_fence BEFORE INSERT OR UPDATE OF attempt_id,fence,text,reasoning_summary,reasoning_duration_ms ON app.ai_checkpoints
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();
