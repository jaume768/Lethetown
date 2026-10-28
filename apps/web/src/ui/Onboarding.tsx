import { useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { Modal } from "./Modal";

const STORAGE_KEY = "lethetown.onboarding.v1";
const STEPS: { title: MessageKey; text: MessageKey; icon: string }[] = [
  { title: "onboarding.step1.title", text: "onboarding.step1.text", icon: "🏘" },
  { title: "onboarding.step2.title", text: "onboarding.step2.text", icon: "🧠" },
  { title: "onboarding.step3.title", text: "onboarding.step3.text", icon: "🎬" },
];

/** ¿Hay que enseñar el onboarding? (localStorage puede fallar: entonces se enseña). */
export function shouldOnboard(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "done";
  } catch {
    return true;
  }
}

function markDone() {
  try {
    localStorage.setItem(STORAGE_KEY, "done");
  } catch {
    /* sin almacenamiento: se volverá a enseñar, no pasa nada */
  }
}

/** Onboarding de 3 pasos: qué ves, cómo funciona la memoria y cómo intervenir. */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const close = () => {
    markDone();
    onClose();
  };
  return (
    <Modal title={t("onboarding.title")} onClose={close} className="narrow onboarding">
      <div className="onboarding-step" aria-live="polite">
        <div className="onboarding-icon" aria-hidden="true">
          {current.icon}
        </div>
        <h4>{t(current.title)}</h4>
        <p className="readable">{t(current.text)}</p>
        <p className="muted small">{t("onboarding.step", { n: step + 1 })}</p>
      </div>
      <div className="row">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
          {t("onboarding.back")}
        </button>
        {step < STEPS.length - 1 ? (
          <button className="btn primary" onClick={() => setStep(step + 1)}>
            {t("onboarding.next")}
          </button>
        ) : (
          <button className="btn primary" onClick={close}>
            {t("onboarding.done")}
          </button>
        )}
      </div>
    </Modal>
  );
}
