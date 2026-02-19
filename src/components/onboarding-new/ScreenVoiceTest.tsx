import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BaukaloCharacter, BaukaloPose } from "./BaukaloCharacter";
import { Keyboard } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { commands } from "@/bindings";
import {
  formatKeyCombination,
  getKeyName,
  normalizeKey,
} from "@/lib/utils/keyboard";

interface ScreenVoiceTestProps {
  onNext: () => void;
}

export const ScreenVoiceTest: React.FC<ScreenVoiceTestProps> = ({ onNext }) => {
  const { t } = useTranslation();
  const { settings, updateBinding } = useSettings();
  const osType = useOsType();
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [originalBinding, setOriginalBinding] = useState("");

  const currentBinding = useMemo(
    () =>
      settings?.bindings?.transcribe?.current_binding ??
      t("onboardingNew.shortcutSetup.fallback"),
    [settings?.bindings?.transcribe?.current_binding, t],
  );

  const displayedShortcut = useMemo(() => {
    if (isRecordingShortcut) {
      if (recordedKeys.length === 0) {
        return t("settings.general.shortcut.pressKeys");
      }
      return formatKeyCombination(recordedKeys.join("+"), osType);
    }
    return formatKeyCombination(currentBinding, osType);
  }, [currentBinding, isRecordingShortcut, osType, recordedKeys, t]);

  const pose: BaukaloPose = "cool";

  useEffect(() => {
    if (!isRecordingShortcut) return;

    let cancelled = false;

    const handleCancel = async () => {
      if (cancelled) return;
      try {
        if (originalBinding) {
          await updateBinding("transcribe", originalBinding);
        }
      } finally {
        await commands.resumeBinding("transcribe").catch(console.error);
        setIsRecordingShortcut(false);
        setPressedKeys([]);
        setRecordedKeys([]);
        setOriginalBinding("");
      }
    };

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (cancelled) return;
      if (e.repeat) return;
      if (e.key === "Escape") {
        e.preventDefault();
        await handleCancel();
        return;
      }

      e.preventDefault();
      const key = normalizeKey(getKeyName(e, osType));

      setPressedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setRecordedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      if (cancelled) return;
      e.preventDefault();
      const key = normalizeKey(getKeyName(e, osType));

      const nextPressed = pressedKeys.filter((k) => k !== key);
      setPressedKeys(nextPressed);

      if (nextPressed.length === 0 && recordedKeys.length > 0) {
        const modifiers = [
          "ctrl",
          "control",
          "shift",
          "alt",
          "option",
          "meta",
          "command",
          "cmd",
          "super",
          "win",
          "windows",
        ];
        const sortedKeys = [...recordedKeys].sort((a, b) => {
          const aIsModifier = modifiers.includes(a.toLowerCase());
          const bIsModifier = modifiers.includes(b.toLowerCase());
          if (aIsModifier && !bIsModifier) return -1;
          if (!aIsModifier && bIsModifier) return 1;
          return 0;
        });

        try {
          await updateBinding("transcribe", sortedKeys.join("+"));
        } finally {
          await commands.resumeBinding("transcribe").catch(console.error);
          setIsRecordingShortcut(false);
          setPressedKeys([]);
          setRecordedKeys([]);
          setOriginalBinding("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isRecordingShortcut, osType, originalBinding, pressedKeys, recordedKeys, updateBinding]);

  const startShortcutRecording = async () => {
    if (isRecordingShortcut) return;
    setOriginalBinding(currentBinding);
    await commands.suspendBinding("transcribe").catch(console.error);
    setPressedKeys([]);
    setRecordedKeys([]);
    setIsRecordingShortcut(true);
  };

  return (
    <div className="flex flex-col items-center h-full w-full py-5 animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md gap-4 px-4">
        <BaukaloCharacter pose={pose} />

        <div className="text-center mb-1">
          <h1 className="text-lg font-semibold italic text-logo-primary transition-all">
            {t("onboardingNew.shortcutSetup.speech")}
          </h1>
        </div>

        <div className="w-full bg-surface border border-border rounded-xl p-5 flex flex-col items-center justify-center min-h-[140px] gap-3 shadow-sm">
          <div className="flex items-center justify-center gap-2 text-text/80">
            <Keyboard className="w-5 h-5 text-logo-primary" />
            <p className="text-sm font-medium">
              {t("onboardingNew.shortcutSetup.currentShortcutLabel")}
            </p>
          </div>
          <button
            type="button"
            onClick={startShortcutRecording}
            className="px-4 py-2 rounded-lg bg-logo-primary/10 border border-logo-primary/30 hover:bg-logo-primary/15 transition-colors"
          >
            <p className="text-lg font-semibold tracking-wide text-logo-primary">
              {displayedShortcut}
            </p>
          </button>
          <p className="text-xs text-center text-muted-foreground">
            {t("onboardingNew.shortcutSetup.tapToChange")}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 w-full mt-auto shrink-0">
        <Button onClick={onNext} className="w-64 h-12 text-base" size="lg">
          {t("onboardingNew.shortcutSetup.cta")}
        </Button>
      </div>
    </div>
  );
};
