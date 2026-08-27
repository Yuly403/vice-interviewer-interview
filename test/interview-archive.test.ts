/**
 * 面试档案 Markdown 生成器单元测试
 *
 * 覆盖 generateInterviewArchive 的全部 8 个章节 + toSafeName
 */
import { describe, it, expect } from "vitest";
import { generateInterviewArchive, toSafeName } from "@vice/domain";
import type { ArchiveInput } from "@vice/domain";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeArchiveInput(overrides: Partial<ArchiveInput> = {}): ArchiveInput {
  return {
    interviewId: "int-test-001",
    revision: 3,
    scheduledAt: "2026-07-15T14:00:00.000Z",
    roundType: "first_round",
    positionName: "高级前端工程师",
    participants: [
      { displayName: "面试官甲", role: "interviewer" },
      { displayName: "候选人甲", role: "candidate" },
    ],
    overview: "候选人技术基础扎实，项目经验丰富，沟通表达清晰。",
    strengths: ["React 原理理解深入", "项目架构能力强", "代码质量意识好"],
    risks: ["跨平台经验较少", "对后端技术栈不够熟悉"],
    openQuestions: ["是否愿意接受加班", "期望薪资范围"],
    uncoveredTopics: ["移动端适配经验"],
    nextRoundFocus: ["深入考察跨端方案选型能力", "评估团队管理潜力"],
    suggestedDecision: "pass",
    humanDecision: "pass",
    approvedBy: "李主管",
    approvedAt: "2026-07-15T18:00:00.000Z",
    conclusions: [
      {
        dimension: "technical",
        contentType: "inference",
        text: "候选人 React 虚拟 DOM 和 Fiber 架构理解深入。",
        aiGenerated: true,
        humanEdited: false,
        evidenceRefs: [
          {
            sourceType: "transcript",
            quote: "React 的 Fiber 架构其实就是一个可中断的异步渲染机制",
            speakerRole: "candidate",
            occurredAt: "2026-07-15T14:15:00.000Z",
          },
        ],
      },
      {
        dimension: "technical",
        contentType: "fact",
        text: "候选人在前公司主导了微前端架构落地。",
        aiGenerated: true,
        humanEdited: true,
        evidenceRefs: [
          {
            sourceType: "transcript",
            quote: "我们用了 qiankun 作为主框架",
            speakerRole: "candidate",
            occurredAt: "2026-07-15T14:25:00.000Z",
          },
        ],
      },
      {
        dimension: "communication",
        contentType: "inference",
        text: "表达逻辑清晰，能快速抓住问题重点。",
        aiGenerated: true,
        humanEdited: false,
        evidenceRefs: [],
      },
      {
        dimension: "collaboration",
        contentType: "human_decision",
        text: "跨部门协作经验丰富。",
        aiGenerated: false,
        humanEdited: false,
        evidenceRefs: [],
      },
    ],
    topics: [
      { title: "React 原理", why: "考察核心技术栈深度", status: "covered" },
      { title: "项目架构", why: "评估架构设计能力", status: "covered" },
      { title: "团队协作", why: "了解协作风格", status: "started" },
    ],
    transcriptLineCount: 128,
    ...overrides,
  };
}

// ─── 档案生成 ────────────────────────────────────────────────────────────────

describe("generateInterviewArchive", () => {
  describe("章节 1: 面试概览", () => {
    it("includes candidate name in title", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("# 候选人甲");
      expect(markdown).toContain("初面");
    });

    it("includes interview metadata table", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("| **候选人** | 候选人甲 |");
      expect(markdown).toContain("| **面试官** | 面试官甲 |");
      expect(markdown).toContain("| **岗位** | 高级前端工程师 |");
      expect(markdown).toContain("| **轮次** | 初面 |");
      expect(markdown).toContain("| **逐字稿行数** | 128 |");
      expect(markdown).toContain("| **证据引用数** | 2 |");
    });

    it("uses roundType as fallback position name when positionName is null", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput({ positionName: null }));
      expect(markdown).toContain("| **岗位** | 初面 |");
    });

    it("handles missing participants gracefully", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput({ participants: [] }));
      expect(markdown).toContain("未知候选人");
      expect(markdown).toContain("未知");
    });
  });

  describe("章节 2: 面试计划覆盖", () => {
    it("includes topic coverage table", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("| React 原理 | 考察核心技术栈深度 | 已覆盖 |");
      expect(markdown).toContain("| 团队协作 | 了解协作风格 | 已开始 |");
    });

    it("shows placeholder when no topics", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput({ topics: [] }));
      expect(markdown).toContain("面试计划未包含话题信息");
    });
  });

  describe("章节 3: 综合概览", () => {
    it("includes overview text", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("候选人技术基础扎实");
    });

    it("shows placeholder when overview is null", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput({ overview: null }));
      expect(markdown).toContain("(未填写)");
    });
  });

  describe("章节 4: 分维度评价", () => {
    it("groups conclusions by dimension", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("### 技术能力");
      expect(markdown).toContain("### 沟通表达");
      expect(markdown).toContain("### 协作能力");
    });

    it("includes content type labels (with space before parens)", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      // The code generates: "**推断** (AI)" — note the space
      expect(markdown).toContain("**推断** (AI)");
      expect(markdown).toContain("**事实** (AI) (人工修订)");
      expect(markdown).toContain("**人工判断**");
    });

    it("includes evidence quotes with speaker role", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain('"React 的 Fiber 架构其实就是一个可中断的异步渲染机制"');
      expect(markdown).toContain("[候选人]");
    });

    it("handles conclusions with no evidence (no evidence section shown)", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      // The communication conclusion has no evidence refs
      const commIdx = markdown.indexOf("### 沟通表达");
      const afterComm = markdown.slice(commIdx, markdown.indexOf("### 协作能力"));
      expect(afterComm).not.toContain("证据引用");
    });
  });

  describe("章节 5-6: 亮点 + 风险", () => {
    it("lists strengths", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("- React 原理理解深入");
    });

    it("lists risks", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("- 跨平台经验较少");
    });

    it("handles empty arrays with (无)", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput({ strengths: [], risks: [] }));
      expect(markdown).toContain("- (无)");
    });

    it("includes open questions subsection", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("### 待确认问题");
      expect(markdown).toContain("- 是否愿意接受加班");
    });

    it("includes uncovered topics subsection", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("### 未覆盖话题");
      expect(markdown).toContain("- 移动端适配经验");
    });
  });

  describe("章节 7: 结论", () => {
    it("shows AI suggestion and human decision", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("| AI 建议 | ✅ 通过 |");
      expect(markdown).toContain("| 人工决定 | ✅ 通过");
    });

    it("shows next round focus when human passes", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("### 下轮关注");
      expect(markdown).toContain("- 深入考察跨端方案选型能力");
    });

    it("shows ❌ for reject decisions", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput({
        humanDecision: "reject",
        suggestedDecision: "reject",
      }));
      expect(markdown).toContain("| 人工决定 | ❌ 不通过");
    });

    it("shows ⏸ for hold decisions", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput({ humanDecision: "hold" }));
      expect(markdown).toContain("| 人工决定 | ⏸ 待定");
    });
  });

  describe("章节 8: 审批信息", () => {
    it("includes approver name", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("| **审批人** | 李主管 |");
    });

    it("includes approval time (formatted to local time)", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      // approvedAt is ISO timestamp; formatDate converts to local YYYY-MM-DD HH:MM
      expect(markdown).toMatch(/\|\s*\*\*审批时间\*\*\s*\|.*20\d{2}-\d{2}-\d{2}/);
    });

    it("shows (未审批) when no approver", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput({
        approvedBy: null,
        approvedAt: null,
      }));
      expect(markdown).toContain("| **审批人** | (未填写) |");
      expect(markdown).toContain("(未审批)");
    });

    it("includes revision number in approval info", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("| **档案版本** | v3 |");
    });
  });

  describe("syncMeta", () => {
    it("returns correct metadata", () => {
      const { syncMeta } = generateInterviewArchive(makeArchiveInput());
      expect(syncMeta.interviewId).toBe("int-test-001");
      expect(syncMeta.revision).toBe(3);
      expect(syncMeta.lineCount).toBe(128);
      expect(syncMeta.evidenceCount).toBe(2);
      expect(syncMeta.generatedAt).toBeTruthy();
    });
  });

  describe("footer", () => {
    it("includes auto-generated disclaimer", () => {
      const { markdown } = generateInterviewArchive(makeArchiveInput());
      expect(markdown).toContain("本文档由第二面试官自动生成");
    });
  });
});

// ─── toSafeName ──────────────────────────────────────────────────────────────

describe("toSafeName", () => {
  it("replaces special characters with underscores", () => {
    // Slash, colon, angle brackets are in the regex; parens are NOT
    expect(toSafeName("Wang/Ming")).toBe("Wang_Ming");
    expect(toSafeName("test:file<name>")).toBe("test_file_name");
  });

  it("preserves parentheses (not in regex character class)", () => {
    // toSafeName only replaces [\\/:*?"<>|\\s]+; parens are not replaced
    expect(toSafeName("候选人甲 (P7)")).toBe("候选人甲_(P7)");
  });

  it("replaces spaces with underscores", () => {
    expect(toSafeName("高级 前端 工程师")).toBe("高级_前端_工程师");
  });

  it("trims leading/trailing underscores", () => {
    expect(toSafeName("  hello  ")).toBe("hello");
    expect(toSafeName("___test___")).toBe("test");
  });

  it("collapses multiple underscores", () => {
    expect(toSafeName("a   b")).toBe("a_b");
  });

  it("truncates to 80 characters", () => {
    const long = "a".repeat(100);
    expect(toSafeName(long).length).toBeLessThanOrEqual(80);
  });
});
