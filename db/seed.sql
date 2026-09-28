-- Optional starter data. Edit the names/locations, then run in the Supabase SQL Editor.
INSERT INTO branches (name, location, service_times) VALUES
  ('Branch 1', 'Add location', 'Sundays 9:00 AM'),
  ('Branch 2', 'Add location', 'Sundays 9:00 AM'),
  ('Branch 3', 'Add location', 'Sundays 9:00 AM');

-- Example event (7 days from now)
INSERT INTO events (title, description, starts_at, location)
VALUES ('Sunday Worship Service', 'Come and worship with us.', NOW() + INTERVAL '7 days', 'Main Auditorium');
