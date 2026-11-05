-- Full-text search over code: a trigram index, so any part of an identifier or path matches.
CREATE VIRTUAL TABLE `repo_files_fts` USING fts5(`commit_key` UNINDEXED, `path`, `text`, content='repo_files', content_rowid='rowid', tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER `repo_files_ai` AFTER INSERT ON `repo_files` BEGIN
  INSERT INTO `repo_files_fts`(rowid, `commit_key`, `path`, `text`) VALUES (new.rowid, new.`commit_key`, new.`path`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `repo_files_ad` AFTER DELETE ON `repo_files` BEGIN
  INSERT INTO `repo_files_fts`(`repo_files_fts`, rowid, `commit_key`, `path`, `text`) VALUES ('delete', old.rowid, old.`commit_key`, old.`path`, old.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `repo_files_au` AFTER UPDATE ON `repo_files` BEGIN
  INSERT INTO `repo_files_fts`(`repo_files_fts`, rowid, `commit_key`, `path`, `text`) VALUES ('delete', old.rowid, old.`commit_key`, old.`path`, old.`text`);
  INSERT INTO `repo_files_fts`(rowid, `commit_key`, `path`, `text`) VALUES (new.rowid, new.`commit_key`, new.`path`, new.`text`);
END;
