import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BaukaloCharacter, BaukaloPose } from "./BaukaloCharacter";
import { commands, type HistoryEntry } from "@/bindings";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination } from "@/lib/utils/keyboard";

interface ScreenTranscriptionTestProps {
  onNext: () => void;
}

const pickLatestEntry = (entries: HistoryEntry[]): HistoryEntry | null => {
  if (entries.length === 0) return null;
  return entries.reduce((latest, entry) =>
    entry.timestamp > latest.timestamp ? entry : latest,
  );
};

export const ScreenTranscriptionTest: React.FC<ScreenTranscriptionTestProps> = ({
  onNext,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const osType = useOsType();

  const [isProcessing, setIsProcessing] = useState(false);
  const [transcribedText, setTranscribedText] = useState("");
  const baselineTimestampRef = useRef<number>(0);

  const currentBinding =
    settings?.bindings?.transcribe?.current_binding ??
    t("onboardingNew.shortcutSetup.fallback");
  const formattedShortcut = formatKeyCombination(currentBinding, osType);

  const pose: BaukaloPose = useMemo(() => {
    if (isProcessing) return "listen";
    if (transcribedText.trim().length > 0) return "celebrate";
    return "perk";
  }, [isProcessing, transcribedText]);

  useEffect(() => {
    // Ensure runtime handlers are active during onboarding tests, even if
    // app-level post-onboarding init has not run yet.
    Promise.all([commands.initializeEnigo(), commands.initializeShortcuts()]).catch(
      (e) => {
        console.warn(
          "Failed to initialize onboarding transcription test runtime:",
          e,
        );
      },
    );
  }, []);

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
  }, []);

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
        <Button onClick={onNext} className="w-64 h-12 text-base" size="lg">
          {t("onboardingNew.voiceTest.cta")}
        </Button>
      </div>
    </div>
  );
};
