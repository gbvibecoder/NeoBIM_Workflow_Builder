-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."ArtifactType" AS ENUM ('TEXT', 'JSON', 'IMAGE', 'THREE_D', 'FILE', 'TABLE', 'KPI', 'VIDEO');

-- CreateEnum
CREATE TYPE "public"."ExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."FeedbackStatus" AS ENUM ('NEW', 'REVIEWING', 'PLANNED', 'IN_PROGRESS', 'DONE', 'DECLINED');

-- CreateEnum
CREATE TYPE "public"."FeedbackType" AS ENUM ('BUG', 'FEATURE', 'SUGGESTION');

-- CreateEnum
CREATE TYPE "public"."MessageRole" AS ENUM ('USER', 'AI', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."SupportCategory" AS ENUM ('GENERAL', 'WORKFLOW_HELP', 'NODE_EXECUTION', 'BILLING', 'BUG_REPORT', 'FEATURE_REQUEST', 'IFC_PARSING', 'COST_ESTIMATION', 'THREE_D_GENERATION', 'ACCOUNT', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "public"."SupportStatus" AS ENUM ('ACTIVE', 'ESCALATED', 'ADMIN_REPLIED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('FREE', 'PRO', 'TEAM_ADMIN', 'PLATFORM_ADMIN', 'MINI', 'STARTER');

-- CreateEnum
CREATE TYPE "public"."WorkflowComplexity" AS ENUM ('SIMPLE', 'INTERMEDIATE', 'ADVANCED');

-- CreateTable
CREATE TABLE "public"."accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_accounts" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "public"."AdminRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionToken" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_audit_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_roadmap_tasks" (
    "id" TEXT NOT NULL,
    "roadmapId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "reasoning" TEXT,
    "linkedFeedbackIds" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_roadmap_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_roadmaps" (
    "id" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "riskFlags" TEXT[],
    "quickWins" TEXT[],
    "feedbackAnalysis" JSONB NOT NULL DEFAULT '{}',
    "metricsSnapshot" JSONB NOT NULL DEFAULT '{}',
    "generatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_roadmaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."artifacts" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "tileInstanceId" TEXT NOT NULL,
    "type" "public"."ArtifactType" NOT NULL,
    "dataUri" TEXT,
    "data" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."boq_analytics" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "buildingType" TEXT NOT NULL,
    "gfa" DOUBLE PRECISION NOT NULL,
    "floors" INTEGER NOT NULL,
    "costPerM2" DOUBLE PRECISION NOT NULL,
    "materialRatio" DOUBLE PRECISION NOT NULL,
    "laborRatio" DOUBLE PRECISION NOT NULL,
    "masonRate" DOUBLE PRECISION NOT NULL,
    "steelRate" DOUBLE PRECISION NOT NULL,
    "cementRate" DOUBLE PRECISION NOT NULL,
    "ifcQuality" TEXT NOT NULL,
    "provisionalPct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."community_publications" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT[],
    "thumbnailUri" TEXT,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cloneCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isReported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."community_videos" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "videoUrl" TEXT NOT NULL,
    "duration" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "isApproved" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."executions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "tileResults" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."FeedbackType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "screenshotUrl" TEXT,
    "status" "public"."FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."flash_event_completions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flash_event_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."quantity_corrections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT,
    "elementType" TEXT NOT NULL,
    "buildingType" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "extractedQty" DOUBLE PRECISION NOT NULL,
    "correctedQty" DOUBLE PRECISION NOT NULL,
    "correctionRatio" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quantity_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rewardGiven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reviews" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."SupportStatus" NOT NULL DEFAULT 'ACTIVE',
    "category" "public"."SupportCategory" NOT NULL DEFAULT 'GENERAL',
    "subject" TEXT,
    "summary" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "assignedTo" TEXT,
    "satisfaction" INTEGER,
    "feedbackNote" TEXT,
    "pageContext" TEXT,
    "userPlan" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "public"."MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_quick_replies" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "public"."SupportCategory" NOT NULL DEFAULT 'GENERAL',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tile_instances" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "tileType" TEXT NOT NULL,
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tile_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_achievements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "password" TEXT,
    "role" "public"."UserRole" NOT NULL DEFAULT 'FREE',
    "bio" TEXT,
    "apiKeys" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeCurrentPeriodEnd" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripePriceId" TEXT,
    "stripeSubscriptionId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "paymentGateway" TEXT,
    "razorpayPlanId" TEXT,
    "razorpaySubscriptionId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "public"."video_share_links" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "title" TEXT,
    "expiresAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_clones" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_clones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_versions_history" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tileGraph" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "workflow_versions_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflows" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[],
    "tileGraph" JSONB NOT NULL DEFAULT '{"edges": [], "nodes": []}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "thumbnail" TEXT,
    "category" TEXT,
    "complexity" "public"."WorkflowComplexity" NOT NULL DEFAULT 'SIMPLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "public"."accounts"("provider" ASC, "providerAccountId" ASC);

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "public"."accounts"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "admin_accounts_username_key" ON "public"."admin_accounts"("username" ASC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_idx" ON "public"."admin_audit_logs"("action" ASC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_adminId_idx" ON "public"."admin_audit_logs"("adminId" ASC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_createdAt_idx" ON "public"."admin_audit_logs"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ai_roadmap_tasks_roadmapId_idx" ON "public"."ai_roadmap_tasks"("roadmapId" ASC);

-- CreateIndex
CREATE INDEX "ai_roadmap_tasks_status_idx" ON "public"."ai_roadmap_tasks"("status" ASC);

-- CreateIndex
CREATE INDEX "ai_roadmaps_createdAt_idx" ON "public"."ai_roadmaps"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ai_roadmaps_weekOf_idx" ON "public"."ai_roadmaps"("weekOf" ASC);

-- CreateIndex
CREATE INDEX "artifacts_executionId_idx" ON "public"."artifacts"("executionId" ASC);

-- CreateIndex
CREATE INDEX "artifacts_tileInstanceId_idx" ON "public"."artifacts"("tileInstanceId" ASC);

-- CreateIndex
CREATE INDEX "boq_analytics_createdAt_idx" ON "public"."boq_analytics"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "boq_analytics_state_buildingType_idx" ON "public"."boq_analytics"("state" ASC, "buildingType" ASC);

-- CreateIndex
CREATE INDEX "community_publications_authorId_idx" ON "public"."community_publications"("authorId" ASC);

-- CreateIndex
CREATE INDEX "community_publications_cloneCount_idx" ON "public"."community_publications"("cloneCount" ASC);

-- CreateIndex
CREATE INDEX "community_publications_ratingAvg_idx" ON "public"."community_publications"("ratingAvg" ASC);

-- CreateIndex
CREATE INDEX "community_publications_workflowId_idx" ON "public"."community_publications"("workflowId" ASC);

-- CreateIndex
CREATE INDEX "community_videos_authorId_idx" ON "public"."community_videos"("authorId" ASC);

-- CreateIndex
CREATE INDEX "community_videos_createdAt_idx" ON "public"."community_videos"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "executions_createdAt_idx" ON "public"."executions"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "executions_userId_idx" ON "public"."executions"("userId" ASC);

-- CreateIndex
CREATE INDEX "executions_workflowId_idx" ON "public"."executions"("workflowId" ASC);

-- CreateIndex
CREATE INDEX "feedback_status_idx" ON "public"."feedback"("status" ASC);

-- CreateIndex
CREATE INDEX "feedback_type_idx" ON "public"."feedback"("type" ASC);

-- CreateIndex
CREATE INDEX "feedback_userId_idx" ON "public"."feedback"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "flash_event_completions_userId_eventKey_key" ON "public"."flash_event_completions"("userId" ASC, "eventKey" ASC);

-- CreateIndex
CREATE INDEX "flash_event_completions_userId_idx" ON "public"."flash_event_completions"("userId" ASC);

-- CreateIndex
CREATE INDEX "quantity_corrections_createdAt_idx" ON "public"."quantity_corrections"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "quantity_corrections_elementType_buildingType_state_idx" ON "public"."quantity_corrections"("elementType" ASC, "buildingType" ASC, "state" ASC);

-- CreateIndex
CREATE INDEX "quantity_corrections_userId_idx" ON "public"."quantity_corrections"("userId" ASC);

-- CreateIndex
CREATE INDEX "referrals_code_idx" ON "public"."referrals"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "referrals_code_key" ON "public"."referrals"("code" ASC);

-- CreateIndex
CREATE INDEX "referrals_referrerId_idx" ON "public"."referrals"("referrerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_publicationId_userId_key" ON "public"."reviews"("publicationId" ASC, "userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "public"."sessions"("sessionToken" ASC);

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "public"."sessions"("userId" ASC);

-- CreateIndex
CREATE INDEX "support_conversations_assignedTo_idx" ON "public"."support_conversations"("assignedTo" ASC);

-- CreateIndex
CREATE INDEX "support_conversations_category_idx" ON "public"."support_conversations"("category" ASC);

-- CreateIndex
CREATE INDEX "support_conversations_createdAt_idx" ON "public"."support_conversations"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "support_conversations_lastMessageAt_idx" ON "public"."support_conversations"("lastMessageAt" ASC);

-- CreateIndex
CREATE INDEX "support_conversations_priority_idx" ON "public"."support_conversations"("priority" ASC);

-- CreateIndex
CREATE INDEX "support_conversations_status_idx" ON "public"."support_conversations"("status" ASC);

-- CreateIndex
CREATE INDEX "support_conversations_userId_idx" ON "public"."support_conversations"("userId" ASC);

-- CreateIndex
CREATE INDEX "support_messages_conversationId_idx" ON "public"."support_messages"("conversationId" ASC);

-- CreateIndex
CREATE INDEX "support_messages_createdAt_idx" ON "public"."support_messages"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "support_messages_role_idx" ON "public"."support_messages"("role" ASC);

-- CreateIndex
CREATE INDEX "support_quick_replies_category_idx" ON "public"."support_quick_replies"("category" ASC);

-- CreateIndex
CREATE INDEX "tile_instances_workflowId_idx" ON "public"."tile_instances"("workflowId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_action_key" ON "public"."user_achievements"("userId" ASC, "action" ASC);

-- CreateIndex
CREATE INDEX "user_achievements_userId_idx" ON "public"."user_achievements"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_razorpaySubscriptionId_key" ON "public"."users"("razorpaySubscriptionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "public"."users"("stripeCustomerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeSubscriptionId_key" ON "public"."users"("stripeSubscriptionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "public"."verification_tokens"("identifier" ASC, "token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "public"."verification_tokens"("token" ASC);

-- CreateIndex
CREATE INDEX "video_share_links_createdAt_idx" ON "public"."video_share_links"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "video_share_links_createdById_idx" ON "public"."video_share_links"("createdById" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "video_share_links_slug_key" ON "public"."video_share_links"("slug" ASC);

-- CreateIndex
CREATE INDEX "workflow_clones_userId_idx" ON "public"."workflow_clones"("userId" ASC);

-- CreateIndex
CREATE INDEX "workflow_clones_workflowId_idx" ON "public"."workflow_clones"("workflowId" ASC);

-- CreateIndex
CREATE INDEX "workflow_versions_history_workflowId_idx" ON "public"."workflow_versions_history"("workflowId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_history_workflowId_version_key" ON "public"."workflow_versions_history"("workflowId" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "workflows_createdAt_idx" ON "public"."workflows"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "workflows_isTemplate_idx" ON "public"."workflows"("isTemplate" ASC);

-- CreateIndex
CREATE INDEX "workflows_ownerId_idx" ON "public"."workflows"("ownerId" ASC);

-- AddForeignKey
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "public"."admin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_roadmap_tasks" ADD CONSTRAINT "ai_roadmap_tasks_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "public"."ai_roadmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."artifacts" ADD CONSTRAINT "artifacts_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "public"."executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."artifacts" ADD CONSTRAINT "artifacts_tileInstanceId_fkey" FOREIGN KEY ("tileInstanceId") REFERENCES "public"."tile_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."community_publications" ADD CONSTRAINT "community_publications_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."community_publications" ADD CONSTRAINT "community_publications_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "public"."workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."community_videos" ADD CONSTRAINT "community_videos_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."executions" ADD CONSTRAINT "executions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."executions" ADD CONSTRAINT "executions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "public"."workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quantity_corrections" ADD CONSTRAINT "quantity_corrections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."referrals" ADD CONSTRAINT "referrals_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "public"."community_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_conversations" ADD CONSTRAINT "support_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_messages" ADD CONSTRAINT "support_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tile_instances" ADD CONSTRAINT "tile_instances_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "public"."workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_achievements" ADD CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."video_share_links" ADD CONSTRAINT "video_share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_clones" ADD CONSTRAINT "workflow_clones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_clones" ADD CONSTRAINT "workflow_clones_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "public"."workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_versions_history" ADD CONSTRAINT "workflow_versions_history_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "public"."workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflows" ADD CONSTRAINT "workflows_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

