-- Резерв под более длинные target_type (comment и т.д.); категории жалоб хранятся внутри поля reason.
ALTER TABLE "content_reports" ALTER COLUMN "target_type" TYPE varchar(16);
