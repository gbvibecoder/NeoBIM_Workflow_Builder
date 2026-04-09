-- CreateEnum
CREATE TYPE "LiveChatStatus" AS ENUM ('WAITING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "LiveChatRole" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "live_chat_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "LiveChatStatus" NOT NULL DEFAULT 'WAITING',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAdminReplyAt" TIMESTAMP(3),
    "repliedByAdminId" TEXT,
    "repliedByName" TEXT,
    "closedByAdminId" TEXT,
    "closedAt" TIMESTAMP(3),
    "pageContext" TEXT,
    "userPlan" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "LiveChatRole" NOT NULL,
    "senderName" TEXT,
    "content" VARCHAR(3000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_chat_conversations_userId_idx" ON "live_chat_conversations"("userId");

-- CreateIndex
CREATE INDEX "live_chat_conversations_status_lastMessageAt_idx" ON "live_chat_conversations"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "live_chat_conversations_lastMessageAt_idx" ON "live_chat_conversations"("lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "live_chat_messages_conversationId_createdAt_idx" ON "live_chat_messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "live_chat_conversations" ADD CONSTRAINT "live_chat_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_chat_messages" ADD CONSTRAINT "live_chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "live_chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
