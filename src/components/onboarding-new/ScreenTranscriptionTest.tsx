import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BaukaloCharacter, BaukaloPose } from "./BaukaloCharacter";
import { commands, type HistoryEntry } from "@/bindings";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination, getKeyName, normalizeKey } from "@/lib/utils/keyboard";

interface ScreenTranscriptionTestProps {
  onNext: () => void;
}

const pickLatestEntry = (entries: HistoryEntry[]): HistoryEntry | null => {
  if (entries.length === 0) return null;
  return entries.reduce((latest, entry) =>
    entry.timestamp > latest.timestamp ? entry : latest,
  );
};

const normalizeBindingPart = (part: string): string => {
  return part
    .trim()
    .toLowerCase()
    .replace(/_left|_right/g, "")
    .replace("control", "ctrl")
    .replace("meta", "command");
};

export const ScreenTranscriptionTest: React.FC<ScreenTranscriptionTestProps> = ({
  onNext,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const osType = useOsType();
  const isMockOnboarding =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("onboardingMock") !== "0";

  const [isProcessing, setIsProcessing] = useState(false);
  const [transcribedText, setTranscribedText] = useState("");
  const baselineTimestampRef = useRef<number>(0);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const [mockTriggered, setMockTriggered] = useState(false);

  const currentBinding =
    settings?.bindings?.transcribe?.current_binding ??
    t("onboardingNew.shortcutSetup.fallback");
  const formattedShortcut = formatKeyCombination(currentBinding, osType);
  const requiredKeys = useMemo(
    () => currentBinding.split("+").map(normalizeBindingPart),
    [currentBinding],
  );

  const pose: BaukaloPose = useMemo(() => {
    if (isProcessing) return "concentrate";
    if (transcribedText.trim().length > 0) return "happy";
    return "listen";
  }, [isProcessing, transcribedText]);

  const getLatestTimestamp = async (): Promise<number> => {
    const result = await commands.getHistoryEntries();
    if (result.status !== "ok") return 0;
    const latest = pickLatestEntry(result.data);
    return latest?.timestamp ?? 0;
  };

  const waitForFreshTranscription = async (
    sinceTimestamp: number,
  ): Promise<string | null> => {
    for (let i = 0; i < 18; i += 1) {
      const result = await commands.getHistoryEntries();
      if (result.status === "ok") {
        const latest = pickLatestEntry(result.data);
        if (latest && latest.timestamp > sinceTimestamp) {
          return latest.transcription_text;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  };

  useEffect(() => {
    if (isMockOnboarding) return;

    let unlistenFn: (() => void) | null = null;
    let active = true;

    const setup = async () => {
      baselineTimestampRef.current = await getLatestTimestamp();
      unlistenFn = await listen("history-updated", async () => {
        if (!active) return;
        setIsProcessing(true);
        const text = await waitForFreshTranscription(baselineTimestampRef.current);
        if (text) {
          setTranscribedText(text);
          baselineTimestampRef.current = await getLatestTimestamp();
        }
        setIsProcessing(false);
      });
    };

    setup();

    return () => {
      active = false;
      if (unlistenFn) unlistenFn();
    };
  }, [isMockOnboarding]);

  useEffect(() => {
    if (!isMockOnboarding) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = normalizeBindingPart(normalizeKey(getKeyName(e, osType)));
      setPressedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    };

    const onKeyUp = () => {
      setPressedKeys([]);
      setMockTriggered(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isMockOnboarding, osType]);

  useEffect(() => {
    if (!isMockOnboarding || mockTriggered) return;
    const hasAllKeys = requiredKeys.every((key) => pressedKeys.includes(key));
    if (!hasAllKeys) return;

    setMockTriggered(true);
    setIsProcessing(true);
    setTimeout(() => {
      setTranscribedText(t("onboardingNew.transcriptionTest.mockResult"));
      setIsProcessing(false);
    }, 500);
  }, [isMockOnboarding, mockTriggered, pressedKeys, requiredKeys, t]);

  return (
    <div className="flex flex-col items-center h-full w-full py-5 animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md gap-5 px-4">
        <BaukaloCharacter pose={pose} />

        <div className="text-center">
          <h1 className="text-lg font-semibold italic text-logo-primary transition-all">
            {transcribedText
              ? t("onboardingNew.voiceTest.speechAfter")
              : t("onboardingNew.voiceTest.speechBefore")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("onboardingNew.transcriptionTest.shortcutHint", {
              shortcut: formattedShortcut,
            })}
          </p>
        </div>

        <div className="w-full bg-surface border border-border rounded-xl p-4 shadow-sm">
          <textarea
            value={transcribedText}
            readOnly
            placeholder={t("onboardingNew.transcriptionTest.placeholder")}
            className="w-full h-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text resize-none focus:outline-none"
          />
        </div>

        {isProcessing && (
          <p className="text-sm text-muted-foreground">
            {t("onboardingNew.voiceTest.listening")}
          </p>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 w-full mt-auto shrink-0">
        {transcribedText && (
          <Button
            onClick={() => setTranscribedText("")}
            variant="secondary"
            className="w-64 h-10 text-sm"
          >
            {t("onboardingNew.voiceTest.tryAgain")}
          </Button>
        )}
        <Button onClick={onNext} className="w-64 h-12 text-base" size="lg">
          {t("onboardingNew.voiceTest.cta")}
        </Button>
      </div>
    </div>
  );
};
