CREATE TABLE plans (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  api_call_limit INT NOT NULL,
  ai_token_limit INT NOT NULL,
  price_cents INT NOT NULL
);