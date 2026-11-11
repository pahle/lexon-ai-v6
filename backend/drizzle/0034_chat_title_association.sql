ALTER TABLE app.chat_runs
  ADD COLUMN title_version integer,
  ADD COLUMN source_answer_run_id uuid;

ALTER TABLE app.chat_runs
  ADD CONSTRAINT chat_runs_source_answer_fk
    FOREIGN KEY (org_id, source_answer_run_id)
    REFERENCES app.ai_runs(org_id, id) ON DELETE CASCADE;

CREATE INDEX chat_runs_title_source_answer
  ON app.chat_runs(org_id, source_answer_run_id)
  WHERE kind='title';
