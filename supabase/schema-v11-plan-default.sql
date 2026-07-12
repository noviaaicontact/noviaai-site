-- Align default plan with product (Pro only). Safe to run on existing DBs.
ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'pro';
