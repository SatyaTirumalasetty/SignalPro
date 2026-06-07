-- support_tickets.assigned_to has a FK to admin_users(id), but admin_users is empty (0 rows)
-- and is never referenced anywhere in application code — the actual admin-auth mechanism is
-- the users.role column ('admin'/'super_admin', see migration 003 and src/middleware/auth.js
-- requireRole). As a result POST /api/admin/support/tickets/:id/assign always fails with a FK
-- violation (500), since no users.id can ever satisfy a FK against the empty admin_users table.
-- Repoint the FK at users(id), the table the app actually uses to identify admins.
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_assigned_to_fkey;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES users(id);
