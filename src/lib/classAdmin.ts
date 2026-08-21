// The sole administrator for every "?class=<slug>" reunion instance.
// Matches the hardcoded check in schema_class_access_control.sql's RLS
// policies — this is the UI-side mirror of that, not an independent
// source of truth (the database is what actually enforces it).
export const CLASS_ADMIN_EMAIL = "joel.labelle@gmail.com";
