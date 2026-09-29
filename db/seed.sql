-- Creates the four KGC branches. Safe to run again (it never duplicates or overwrites addresses/phones).
-- Address and phone are left empty on purpose: fill them in later from Admin dashboard -> Branches.

-- remove the generic sample branches if you ran the old seed (only if nobody registered under them)
DELETE FROM branches b WHERE b.name IN ('Branch 1','Branch 2','Branch 3')
  AND NOT EXISTS (SELECT 1 FROM members m WHERE m.branch_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM financial_records f WHERE f.branch_id = b.id);

INSERT INTO branches (name, location, sort_order) VALUES
  ('Kingdom Glory Church USA - Utah',            'Utah, USA',         1),
  ('Kingdom Glory Church - Accra Grace Temple',  'Accra, Ghana',      2),
  ('Kingdom Glory Church - Koforidua',           'Koforidua, Ghana',  3),
  ('Kingdom Glory Church - Asamankese',          'Asamankese, Ghana', 4)
ON CONFLICT (name) DO NOTHING;

-- Accra Grace Temple social media
UPDATE branches SET
  facebook_url = 'https://www.facebook.com/KGCgracetemple',
  tiktok_url   = 'https://www.tiktok.com/@kgc.grace.temple',
  youtube_url  = 'https://www.youtube.com/@KGCgracetemple'
WHERE name = 'Kingdom Glory Church - Accra Grace Temple';
