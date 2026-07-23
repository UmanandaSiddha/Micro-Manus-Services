-- migrate:up

-- App-level role. The ADMIN_EMAIL env account is promoted on sign-in.
ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin'));

-- Admins can grant credits from the admin page.
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_reason_check
  CHECK (reason IN ('purchase','coupon','run','refund','admin_grant'));

-- migrate:down

ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_reason_check
  CHECK (reason IN ('purchase','coupon','run','refund'));
ALTER TABLE users DROP COLUMN role;
