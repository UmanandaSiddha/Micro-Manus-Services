-- migrate:up
-- Race backstop: two concurrent sends can both pass the "is a run in progress?"
-- SELECT before either run row exists. This partial unique index makes the
-- second INSERT fail (23505 -> 409), so only one run per thread is ever running.
CREATE UNIQUE INDEX runs_one_running_per_thread ON runs (thread_id)
  WHERE status = 'running';

-- migrate:down
DROP INDEX IF EXISTS runs_one_running_per_thread;
