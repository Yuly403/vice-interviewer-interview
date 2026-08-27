import "./Loading.css";

// ─── Spinner: 旋转动画 + 文案 ───
export function Spinner({ text = "加载中..." }: { text?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-label={text}>
      <div className="spinner" />
      {text && <span className="spinner-text">{text}</span>}
    </div>
  );
}

// ─── PageSpinner: 页面级全屏加载 ───
export function PageSpinner({ text = "加载中..." }: { text?: string }) {
  return (
    <div className="spinner-page">
      <Spinner text={text} />
    </div>
  );
}

// ─── Skeleton: 骨架屏 ───

interface SkeletonBaseProps {
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
  inline?: boolean;
}

export function SkeletonBox({ width = "100%", height = 16, rounded = true, inline }: SkeletonBaseProps) {
  const style: React.CSSProperties = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    borderRadius: rounded ? "var(--radius-4)" : 0,
    display: inline ? "inline-block" : "block",
    marginBottom: inline ? 0 : "var(--space-8)",
  };
  return <div className="skeleton" style={style} aria-hidden="true" />;
}

// ─── CardSkeleton: 列表卡片骨架 ───
export function CardSkeleton() {
  return (
    <div className="skeleton-card">
      <SkeletonBox width="60%" height={18} />
      <SkeletonBox width="40%" height={14} />
      <SkeletonBox width="80%" height={14} />
    </div>
  );
}

// ─── ListSkeleton: 多行骨架 ───
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── TextBlockSkeleton: 段落骨架 ───
export function TextBlockSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-text-block" role="status" aria-label="加载中">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBox
          key={i}
          width={`${i === lines - 1 ? 50 + Math.random() * 30 : 85 + Math.random() * 15}%`}
          height={14}
        />
      ))}
    </div>
  );
}
