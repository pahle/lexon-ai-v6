ALTER TABLE app.ai_operations
  DROP CONSTRAINT ai_operations_status_check,
  ADD CONSTRAINT ai_operations_status_check
    CHECK (status IN ('pending','awaiting_approval','approved','rejected','succeeded','failed','outcome_unknown')),
  DROP CONSTRAINT ai_operations_lifecycle,
  ADD COLUMN decision_by_user_id uuid,
  ADD COLUMN decision text CHECK (decision IS NULL OR decision IN ('approve','reject')),
  ADD COLUMN decided_at timestamptz,
  ADD CONSTRAINT ai_operations_decision_lifecycle CHECK (
    (decision IS NULL AND decided_at IS NULL AND decision_by_user_id IS NULL AND status NOT IN ('approved','rejected'))
    OR (decision='approve' AND status IN ('approved','rejected','succeeded','failed','outcome_unknown') AND decided_at IS NOT NULL AND decision_by_user_id IS NOT NULL)
    OR (decision='reject' AND status='rejected' AND decided_at IS NOT NULL AND decision_by_user_id IS NOT NULL AND result IS NOT NULL AND completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT ai_operations_lifecycle CHECK (
    (status IN ('pending','awaiting_approval','approved') AND result IS NULL AND completed_at IS NULL)
    OR (status IN ('succeeded','rejected','failed','outcome_unknown') AND result IS NOT NULL AND completed_at IS NOT NULL)
  );

ALTER TABLE app.ai_operations
  ADD CONSTRAINT ai_operations_decision_user_fk
    FOREIGN KEY (decision_by_user_id) REFERENCES auth.user(id) ON DELETE RESTRICT;
