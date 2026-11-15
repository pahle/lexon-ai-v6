ALTER TABLE auth."user" ADD COLUMN job_title text;
ALTER TABLE auth."user" ADD CONSTRAINT user_job_title_check
  CHECK (job_title IS NULL OR (job_title = btrim(job_title) AND char_length(job_title) BETWEEN 1 AND 80));
