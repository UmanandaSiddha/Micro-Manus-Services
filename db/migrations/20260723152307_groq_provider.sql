-- migrate:up

ALTER TABLE api_keys DROP CONSTRAINT api_keys_provider_check;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_provider_check
  CHECK (provider IN ('openai','anthropic','moonshot','openrouter','groq'));

-- migrate:down

ALTER TABLE api_keys DROP CONSTRAINT api_keys_provider_check;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_provider_check
  CHECK (provider IN ('openai','anthropic','moonshot','openrouter'));
