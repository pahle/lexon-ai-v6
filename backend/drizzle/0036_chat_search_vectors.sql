ALTER TABLE app.chat_messages
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english',coalesce(user_text,''))) STORED;
--> statement-breakpoint
ALTER TABLE app.ai_runs
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',coalesce(
      CASE WHEN status='completed' THEN final_output ELSE partial_output END,''
    ))
  ) STORED;
