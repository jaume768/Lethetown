import { useEffect, useRef, type ReactNode } from "react";

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
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
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
              Cerrar
            </button>
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}
