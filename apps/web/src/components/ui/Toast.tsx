import { useToast, type ToastItem } from "../../hooks/useToast";
import "./Toast.css";

const ICONS: Record<ToastItem["type"], string> = {
  success: "\u2714",
  error: "\u2718",
  warning: "\u26A0",
  info: "\u2139",
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          role="alert"
          onClick={() => removeToast(t.id)}
        >
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
