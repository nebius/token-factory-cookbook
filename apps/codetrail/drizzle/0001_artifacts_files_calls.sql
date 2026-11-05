CREATE TABLE `artifacts` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`commit_key` text NOT NULL,
	`record` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `calls_commit_idx` ON `calls` (`commit_key`,`at`);--> statement-breakpoint
CREATE TABLE `repo_files` (
	`commit_key` text NOT NULL,
	`path` text NOT NULL,
	`text` text NOT NULL,
	`lines` integer NOT NULL,
	PRIMARY KEY(`commit_key`, `path`)
);
