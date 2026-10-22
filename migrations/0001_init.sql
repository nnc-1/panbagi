-- svg-engine schema. One deployment = one owner, so there is no owner/user table.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,           -- svg | png | webp | jpg
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  r2_key     TEXT NOT NULL,           -- assets/{sha256}
  tags       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE fonts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  family       TEXT NOT NULL,
  weight       INTEGER NOT NULL DEFAULT 400,
  style        TEXT NOT NULL DEFAULT 'normal',
  bytes        INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  r2_key       TEXT NOT NULL,         -- fonts/{sha256}
  license_note TEXT NOT NULL DEFAULT '',
  UNIQUE (family, weight, style)
);

CREATE TABLE chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE templates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id           INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  name              TEXT NOT NULL,
  published_version INTEGER,
  draft_spec        TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chat_id, slug)
);

CREATE TABLE template_versions (
  template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  spec_json    TEXT NOT NULL,
  spec_hash    TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (template_id, version)
);
