-- Accent-insensitive patient and doctor search (see listPatients / listDoctors):
-- the search compares unaccent(column) ILIKE unaccent(term). No index is created
-- on unaccent(column) on purpose: unaccent() is STABLE, not IMMUTABLE, so such an
-- index is rejected, and the usual IMMUTABLE wrapper lies about the dictionary
-- being constant. At this data size a sequential scan is not a concern.
CREATE EXTENSION IF NOT EXISTS unaccent;
