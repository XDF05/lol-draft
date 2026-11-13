-- Initial database setup for the League of Legends Draft Strategy Board.
-- Mounted into the postgres container at /docker-entrypoint-initdb.d/init.sql
-- and executed automatically on first initialization of the data volume.

CREATE SCHEMA IF NOT EXISTS draft_db;
GRANT ALL ON SCHEMA draft_db TO postgres;
