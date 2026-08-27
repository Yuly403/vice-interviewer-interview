import { Component, type ErrorInfo, type ReactNode } from "react";
import "./ErrorBoundary.css";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[ErrorBoundary]", error, info.componentStack); }
  handleRetry = () => this.setState({ hasError: false, error: null });
  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return <div className="error-boundary" role="alert"><div className="error-icon">⚠</div><h3 className="error-title">页面暂时无法加载</h3><p className="error-message">{import.meta.env.DEV ? (this.state.error?.message || "未知错误") : "请重试；如果问题持续，请返回列表后重新进入。"}</p><button type="button" className="btn btn-primary" onClick={this.handleRetry}>重试</button>{import.meta.env.DEV && this.state.error?.stack ? <details className="error-stack"><summary>技术详情</summary><pre>{this.state.error.stack}</pre></details> : null}</div>;
  }
}
