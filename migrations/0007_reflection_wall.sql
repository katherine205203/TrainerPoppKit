PRAGMA foreign_keys = ON;

-- Reflection Wall state stays within the shared Activity/Session lifecycle.
CREATE TABLE reflection_wall_configs (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  identity_mode TEXT NOT NULL DEFAULT 'anonymous' CHECK (identity_mode IN ('anonymous','named')),
  post_limit INTEGER NOT NULL DEFAULT 5 CHECK (post_limit BETWEEN 1 AND 10),
  phase TEXT NOT NULL DEFAULT 'DRAFT' CHECK (phase IN ('DRAFT','OPEN','PAUSED','CLOSED','ARCHIVED')),
  access_slug TEXT NOT NULL UNIQUE,
  presentation_mode TEXT NOT NULL DEFAULT 'off' CHECK (presentation_mode IN ('off','all','focus','spotlight','cluster','blank')),
  focus_column_id TEXT,
  spotlight_post_id TEXT,
  focus_cluster_id TEXT,
  clusters_visible INTEGER NOT NULL DEFAULT 1 CHECK (clusters_visible IN (0,1)),
  started_once INTEGER NOT NULL DEFAULT 0 CHECK (started_once IN (0,1)),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reflection_wall_columns (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 30),
  question TEXT NOT NULL DEFAULT '' CHECK (length(question) <= 200),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 3),
  color_key TEXT NOT NULL DEFAULT 'gold' CHECK (color_key IN ('gold','pink','aqua','purple')),
  UNIQUE(activity_id, sort_order),
  UNIQUE(activity_id, id)
);

-- A participant capability is scoped to this wall, never joined to the shared
-- Session participant table. Anonymous actors have no name or team snapshot.
CREATE TABLE reflection_wall_actors (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  capability_hash TEXT NOT NULL UNIQUE,
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) <= 60),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX ix_reflection_actors_activity ON reflection_wall_actors(activity_id, created_at);

CREATE TABLE reflection_wall_clusters (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  color_key TEXT NOT NULL DEFAULT 'pink' CHECK (color_key IN ('gold','pink','aqua','purple')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(activity_id, id)
);

CREATE TABLE reflection_wall_posts (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  column_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES reflection_wall_actors(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 500),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  cluster_id TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id, column_id) REFERENCES reflection_wall_columns(activity_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES reflection_wall_clusters(id) ON DELETE SET NULL
);
CREATE INDEX ix_reflection_posts_column ON reflection_wall_posts(activity_id, column_id, hidden, created_at);
CREATE INDEX ix_reflection_posts_actor ON reflection_wall_posts(activity_id, actor_id, created_at);
CREATE UNIQUE INDEX ix_reflection_posts_idempotency ON reflection_wall_posts(activity_id, actor_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE reflection_wall_comments (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES reflection_wall_posts(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES reflection_wall_actors(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 300),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_reflection_comments_post ON reflection_wall_comments(activity_id, post_id, hidden, created_at);
CREATE UNIQUE INDEX ix_reflection_comments_idempotency ON reflection_wall_comments(activity_id, actor_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE reflection_wall_reactions (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES reflection_wall_actors(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','comment')),
  target_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction IN ('heart','clap','haha','sad','empathy','inspireful')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(activity_id, actor_id, target_type, target_id, reaction)
);
CREATE INDEX ix_reflection_reactions_target ON reflection_wall_reactions(activity_id, target_type, target_id, reaction);

-- Cursor-only event log deliberately contains no participant identity or content.
CREATE TABLE reflection_wall_events (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_reflection_events_activity_cursor ON reflection_wall_events(activity_id, cursor);

CREATE TABLE reflection_wall_presenter_sessions (
  token_hash TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_reflection_presenter_activity ON reflection_wall_presenter_sessions(activity_id, created_at);

-- Every content change commits a cursor event in the same D1 statement. Public
-- clients poll the cursor and refresh an audience-filtered snapshot on change.
CREATE TRIGGER reflection_post_insert_event AFTER INSERT ON reflection_wall_posts BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'post.changed');
END;
CREATE TRIGGER reflection_post_update_event AFTER UPDATE ON reflection_wall_posts BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'post.changed');
END;
CREATE TRIGGER reflection_post_delete_event AFTER DELETE ON reflection_wall_posts BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (OLD.activity_id,'post.changed');
END;
CREATE TRIGGER reflection_comment_insert_event AFTER INSERT ON reflection_wall_comments BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'comment.changed');
END;
CREATE TRIGGER reflection_comment_update_event AFTER UPDATE ON reflection_wall_comments BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'comment.changed');
END;
CREATE TRIGGER reflection_comment_delete_event AFTER DELETE ON reflection_wall_comments BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (OLD.activity_id,'comment.changed');
END;
CREATE TRIGGER reflection_reaction_insert_event AFTER INSERT ON reflection_wall_reactions BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'reaction.changed');
END;
CREATE TRIGGER reflection_reaction_delete_event AFTER DELETE ON reflection_wall_reactions BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (OLD.activity_id,'reaction.changed');
END;
CREATE TRIGGER reflection_cluster_insert_event AFTER INSERT ON reflection_wall_clusters BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'cluster.changed');
END;
CREATE TRIGGER reflection_cluster_update_event AFTER UPDATE ON reflection_wall_clusters BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'cluster.changed');
END;
CREATE TRIGGER reflection_cluster_delete_event AFTER DELETE ON reflection_wall_clusters BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (OLD.activity_id,'cluster.changed');
END;
CREATE TRIGGER reflection_column_update_event AFTER UPDATE ON reflection_wall_columns BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'columns.changed');
END;
CREATE TRIGGER reflection_column_insert_event AFTER INSERT ON reflection_wall_columns BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (NEW.activity_id,'columns.changed');
END;
CREATE TRIGGER reflection_column_delete_event AFTER DELETE ON reflection_wall_columns BEGIN
  INSERT INTO reflection_wall_events(activity_id,event_type) VALUES (OLD.activity_id,'columns.changed');
END;
