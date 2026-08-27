import { useEffect, useCallback, useRef, type ReactNode } from "react";
import "./Modal.css";

export interface ModalAction {
  label: string;
  variant?: "primary" | "danger" | "outline" | "ghost";
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ModalAction[];
  closeOnMask?: boolean;
  size?: "sm" | "md" | "lg";
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  open,
  title,
  children,
  onClose,
  actions,
  closeOnMask = true,
  size = "md",
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab focus inside modal
      if (e.key === "Tab" && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    // Focus the first focusable element in the modal
    requestAnimationFrame(() => {
      const first = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      // Restore focus to the element that opened the modal
      previousFocusRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="modal-mask"
      onClick={closeOnMask ? onClose : undefined}
    >
      <div
        ref={cardRef}
        className={`modal-card modal-${size}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close btn-ghost" onClick={onClose} aria-label="关闭">
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && actions.length > 0 && (
          <div className="modal-footer">
            {actions.map((a, i) => (
              <button
                key={i}
                type="button"
                className={`btn btn-${a.variant || "outline"}${a.loading ? " loading-spinner" : ""}`}
                onClick={a.onClick}
                disabled={a.loading || a.disabled}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
