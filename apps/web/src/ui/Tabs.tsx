import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabDef<K extends string> {
  id: K;
  label: string;
  /** Aviso (p. ej. dramas nuevos). */
  badge?: number;
}

interface Props<K extends string> {
  tabs: TabDef<K>[];
  active: K;
  onChange: (id: K) => void;
  label: string;
  children: ReactNode;
}

/** Pestañas accesibles (WAI-ARIA tabs): flechas izquierda/derecha, Inicio y Fin. */
export function Tabs<K extends string>({ tabs, active, onChange, label, children }: Props<K>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="tabs">
      <div className="tablist" role="tablist" aria-label={label}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            className={`tab ${tab.id === active ? "active" : ""}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {tab.label}
            {tab.badge ? (
              <span className="tab-badge" aria-label={`(${tab.badge})`}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div
        className="tabpanel"
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
