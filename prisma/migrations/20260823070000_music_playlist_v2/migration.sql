-- Playlist v2: mỗi người nhiều playlist, có tên + ảnh bìa + mã share.
--
-- Bảng cũ "MusicPlaylistTrack" (1 playlist phẳng/người) CỐ Ý không bị drop ở đây:
-- dữ liệu được copy sang bảng mới, và chỉ khi đã kiểm tra dữ liệu mới đủ thì
-- migration sau mới xoá bảng cũ. Drop cùng lúc với copy thì một lỗi ở bước copy
-- là mất playlist của người ta, không có đường lùi.

CREATE TABLE IF NOT EXISTS "MusicPlaylist" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "coverMessageId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "shareCode" TEXT NOT NULL,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicPlaylist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MusicPlaylistItem" (
    "id" SERIAL NOT NULL,
    "playlistId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "uri" TEXT NOT NULL,
    "identifier" TEXT,
    "source" TEXT,
    "duration" INTEGER,
    "artworkUrl" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicPlaylistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MusicPlaylist_shareCode_key" ON "MusicPlaylist"("shareCode");
CREATE INDEX IF NOT EXISTS "MusicPlaylist_userId_idx" ON "MusicPlaylist"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "MusicPlaylist_userId_name_key" ON "MusicPlaylist"("userId", "name");
CREATE INDEX IF NOT EXISTS "MusicPlaylistItem_playlistId_idx" ON "MusicPlaylistItem"("playlistId");
CREATE UNIQUE INDEX IF NOT EXISTS "MusicPlaylistItem_playlistId_position_key" ON "MusicPlaylistItem"("playlistId", "position");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MusicPlaylist_userId_fkey') THEN
        ALTER TABLE "MusicPlaylist"
            ADD CONSTRAINT "MusicPlaylist_userId_fkey" FOREIGN KEY ("userId")
            REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MusicPlaylistItem_playlistId_fkey') THEN
        ALTER TABLE "MusicPlaylistItem"
            ADD CONSTRAINT "MusicPlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId")
            REFERENCES "MusicPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Backfill: mỗi người đang có bài trong bảng cũ được một playlist tên "Playlist cũ".
-- DISTINCT phải nằm trong subquery: để DISTINCT ở SELECT ngoài thì shareCode random
-- khác nhau mỗi dòng nên không dòng nào trùng, và mỗi bài sẽ thành một playlist.
INSERT INTO "MusicPlaylist" ("userId", "name", "shareCode", "createdAt", "updatedAt")
SELECT u."userId",
       'Playlist cũ',
       upper(substr(md5(random()::text || u."userId"), 1, 8)),
       now(),
       now()
FROM (SELECT DISTINCT "userId" FROM "MusicPlaylistTrack") u
ON CONFLICT DO NOTHING;

INSERT INTO "MusicPlaylistItem" ("playlistId", "position", "title", "uri", "source", "duration", "addedAt")
SELECT p."id", t."position", t."title", t."uri", t."source", t."duration", t."addedAt"
FROM "MusicPlaylistTrack" t
JOIN "MusicPlaylist" p ON p."userId" = t."userId" AND p."name" = 'Playlist cũ'
ON CONFLICT DO NOTHING;
