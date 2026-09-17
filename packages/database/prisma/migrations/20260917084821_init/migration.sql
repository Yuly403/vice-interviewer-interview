-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "ownerUserId" TEXT,
    "idempotencyKey" TEXT,
    "candidateKey" TEXT,
    "jobKey" TEXT,
    "packageJson" TEXT,
    "packageHash" TEXT,
    "applicationId" TEXT NOT NULL,
    "positionName" TEXT,
    "roundType" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "status" TEXT NOT NULL DEFAULT 'created',
    "feishuEventId" TEXT,
    "feishuMeetingId" TEXT,
    "meetingBindingSource" TEXT,
    "packageRevision" INTEGER NOT NULL DEFAULT 0,
    "planRevision" INTEGER NOT NULL DEFAULT 0,
    "transcriptRevision" INTEGER NOT NULL DEFAULT 0,
    "approvedReviewRevision" INTEGER,
    "ledgerStatus" TEXT NOT NULL DEFAULT 'not_set',
    "ledgerTransitions" TEXT NOT NULL DEFAULT '[]',
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewPlan" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "openingBudgetMinutes" INTEGER NOT NULL DEFAULT 5,
    "closingBudgetMinutes" INTEGER NOT NULL DEFAULT 5,
    "totalDurationMinutes" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "openingQuestion" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "estimatedMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unasked',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'missing',
    "evidenceLineIds" TEXT NOT NULL DEFAULT '[]',
    "aiExplanation" TEXT,
    "humanOverrideValue" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowupQuestion" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "question" TEXT NOT NULL,

    CONSTRAINT "FollowupQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicSignal" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "TopicSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicSourceRef" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRevision" INTEGER,
    "quote" TEXT NOT NULL,
    "paragraphIndex" INTEGER,

    CONSTRAINT "TopicSourceRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewParticipant" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "userId" TEXT,
    "feishuOpenId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "roleSource" TEXT NOT NULL DEFAULT 'unknown',
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "InterviewParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptLine" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "platformSentenceId" TEXT,
    "dedupKey" TEXT,
    "speakerPlatformId" TEXT,
    "speakerDisplayName" TEXT NOT NULL,
    "speakerRole" TEXT NOT NULL DEFAULT 'unknown',
    "roleSource" TEXT NOT NULL DEFAULT 'unknown',
    "text" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TranscriptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptLineRevision" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "oldText" TEXT NOT NULL,
    "newText" TEXT NOT NULL,
    "modifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptLineRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSuggestion" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "topicId" TEXT,
    "observation" TEXT NOT NULL,
    "suggestedQuestion" TEXT,
    "evidenceLineIds" TEXT NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL,
    "generation" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDraft" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reviewStatus" TEXT NOT NULL DEFAULT 'not_started',
    "overview" TEXT,
    "strengths" TEXT NOT NULL DEFAULT '[]',
    "risks" TEXT NOT NULL DEFAULT '[]',
    "openQuestions" TEXT NOT NULL DEFAULT '[]',
    "uncoveredTopics" TEXT NOT NULL DEFAULT '[]',
    "nextRoundFocus" TEXT NOT NULL DEFAULT '[]',
    "suggestedDecision" TEXT,
    "humanDecision" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "syncConflicts" TEXT,
    "syncConflictsResolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewConclusion" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "humanEdited" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReviewConclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRef" (
    "id" TEXT NOT NULL,
    "conclusionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "speakerRole" TEXT,
    "occurredAt" TIMESTAMP(3),

    CONSTRAINT "EvidenceRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetRevision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "feishuOpenId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'recruiter',
    "avatarUrl" TEXT,
    "feishuRefreshToken" TEXT,
    "feishuRefreshTokenEncrypted" TEXT,
    "feishuTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureLease" (
    "interviewId" TEXT NOT NULL,
    "ownerWorkerId" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cursor" TEXT,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "CaptureLease_pkey" PRIMARY KEY ("interviewId")
);

-- CreateTable
CREATE TABLE "WorkspaceSync" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "reviewRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "manifestJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "targetPath" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "fieldName" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Interview_idempotencyKey_key" ON "Interview"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Interview_workspaceId_scheduledAt_idx" ON "Interview"("workspaceId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_ownerUserId_idx" ON "Interview"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewPlan_interviewId_key" ON "InterviewPlan"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewParticipant_interviewId_userId_key" ON "InterviewParticipant"("interviewId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptLine_interviewId_sourceType_platformSentenceId_key" ON "TranscriptLine"("interviewId", "sourceType", "platformSentenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_idempotencyKey_key" ON "Approval"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_feishuOpenId_key" ON "User"("feishuOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSync_interviewId_reviewRevision_key" ON "WorkspaceSync"("interviewId", "reviewRevision");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPlan" ADD CONSTRAINT "InterviewPlan_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InterviewPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupQuestion" ADD CONSTRAINT "FollowupQuestion_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicSignal" ADD CONSTRAINT "TopicSignal_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicSourceRef" ADD CONSTRAINT "TopicSourceRef_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewParticipant" ADD CONSTRAINT "InterviewParticipant_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptLine" ADD CONSTRAINT "TranscriptLine_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptLineRevision" ADD CONSTRAINT "TranscriptLineRevision_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "TranscriptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSuggestion" ADD CONSTRAINT "LiveSuggestion_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDraft" ADD CONSTRAINT "ReviewDraft_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewConclusion" ADD CONSTRAINT "ReviewConclusion_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ReviewDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_conclusionId_fkey" FOREIGN KEY ("conclusionId") REFERENCES "ReviewConclusion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureLease" ADD CONSTRAINT "CaptureLease_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSync" ADD CONSTRAINT "WorkspaceSync_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
