-- After you register on the website with YOUR email, run this once to make yourself the first admin.
UPDATE users
SET role = 'SUPER_ADMIN', status = 'ACTIVE', email_verified = TRUE
WHERE LOWER(email) = LOWER('PUT-YOUR-EMAIL-HERE');
