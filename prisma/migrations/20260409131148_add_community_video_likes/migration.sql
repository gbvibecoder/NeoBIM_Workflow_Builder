-- CreateTable
CREATE TABLE "community_video_likes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_video_likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_video_likes_videoId_idx" ON "community_video_likes"("videoId");

-- CreateIndex
CREATE INDEX "community_video_likes_userId_idx" ON "community_video_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "community_video_likes_userId_videoId_key" ON "community_video_likes"("userId", "videoId");

-- AddForeignKey
ALTER TABLE "community_video_likes" ADD CONSTRAINT "community_video_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_video_likes" ADD CONSTRAINT "community_video_likes_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "community_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
