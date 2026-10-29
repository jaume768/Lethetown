import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../i18n";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Botones extra junto a "Cerrar". */
  actions?: ReactNode;
  className?: string;
}

/** Diálogo modal accesible: role=dialog, Escape cierra, foco al abrir y devuelto al cerrar. */
export function Modal({ title, onClose, children, actions, className = "" }: Props) {
  const ref = useRef<HTMLElement>(null);
  // onClose suele ser una flecha nueva en cada render del padre (que se repinta con cada delta
  // del mundo): si fuera dependencia del efecto, el foco saltaría al diálogo sin parar y no se
  // podría escribir en sus campos.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="modal-back" onClick={onClose}>
      <section
        ref={ref}
        className={`panel modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row">
          <h3>{title}</h3>
          <div className="row gap">
            {actions}
            <button className="btn" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}
