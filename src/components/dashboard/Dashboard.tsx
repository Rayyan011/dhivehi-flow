import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRight,
  BookOpen,
  Gauge,
  Keyboard,
  Mic,
  Sparkles,
  Type,
  Youtube,
} from "lucide-react";
import { commands, type HistoryEntry } from "@/bindings";

const WORDS_PER_TYPING_MINUTE = 40;
const WORDS_PER_DICTATION_MINUTE = 90;
const KEYSTROKES_PER_WORD = 5;

const countWords = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/u).length;
};

export const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEntries = useCallback(async () => {
    try {
      const result = await commands.getHistoryEntries();
      if (result.status === "ok") {
        setEntries(result.data);
      }
    } catch (error) {
      console.error("Failed to load dashboard history:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();

    const setupListener = async () => {
      const unlisten = await listen("history-updated", () => {
        loadEntries();
      });
      return unlisten;
    };

    const unlistenPromise = setupListener();

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadEntries]);

  const stats = useMemo(() => {
    const words = entries.reduce((sum, entry) => {
      const text = entry.post_processed_text || entry.transcription_text;
      return sum + countWords(text);
    }, 0);

    const sessions = entries.length;
    const keystrokesSaved = words * KEYSTROKES_PER_WORD;
    const secondsSaved = Math.max(
      0,
      Math.round(
        (words / WORDS_PER_TYPING_MINUTE - words / WORDS_PER_DICTATION_MINUTE) *
          60,
      ),
    );

    return {
      sessions,
      words,
      keystrokesSaved,
      wordsPerMinute: sessions > 0 ? WORDS_PER_DICTATION_MINUTE : 0,
      secondsSaved,
    };
  }, [entries]);

  const integerFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  );

  const decimalFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [i18n.language],
  );

  const openResource = async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      console.error(`Failed to open resource URL: ${url}`, error);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl w-full mx-auto">
        <div className="rounded-lg border border-mid-gray/20 bg-background px-4 py-3 text-center text-sm text-text/70">
          {t("dashboard.loading")}
        </div>
      </div>
    );
  }

  const cards = [
    {
      key: "sessions",
      label: t("dashboard.cards.sessions.title"),
      value: integerFormatter.format(stats.sessions),
      description: t("dashboard.cards.sessions.description"),
      icon: Mic,
      iconClass: "bg-logo-primary/15 text-logo-primary",
    },
    {
      key: "words",
      label: t("dashboard.cards.words.title"),
      value: integerFormatter.format(stats.words),
      description: t("dashboard.cards.words.description"),
      icon: Type,
      iconClass: "bg-logo-primary/15 text-logo-primary",
    },
    {
      key: "wpm",
      label: t("dashboard.cards.wpm.title"),
      value: decimalFormatter.format(stats.wordsPerMinute),
      description: t("dashboard.cards.wpm.description"),
      icon: Gauge,
      iconClass: "bg-logo-primary/15 text-logo-primary",
    },
    {
      key: "keystrokes",
      label: t("dashboard.cards.keystrokes.title"),
      value: integerFormatter.format(stats.keystrokesSaved),
      description: t("dashboard.cards.keystrokes.description"),
      icon: Keyboard,
      iconClass: "bg-logo-primary/15 text-logo-primary",
    },
  ];

  const resources = [
    {
      key: "recommendedModels",
      label: t("dashboard.resources.items.recommendedModels"),
      icon: Sparkles,
      url: "https://handy.computer",
      iconClass: "text-logo-primary",
    },
    {
      key: "youtubeGuides",
      label: t("dashboard.resources.items.youtubeGuides"),
      icon: Youtube,
      url: "https://www.youtube.com/results?search_query=handy+dictation+app",
      iconClass: "text-logo-primary",
    },
    {
      key: "documentation",
      label: t("dashboard.resources.items.documentation"),
      icon: BookOpen,
      url: "https://github.com/cjpais/handy",
      iconClass: "text-logo-primary",
    },
  ];

  return (
    <div className="max-w-3xl w-full mx-auto space-y-4">
      <section>
        <div className="rounded-lg bg-logo-primary px-5 py-4 text-text">
          <h1 className="text-xl font-semibold leading-tight md:text-2xl">
            {t("dashboard.hero.title", {
              seconds: integerFormatter.format(stats.secondsSaved),
              appName: "Baukalo",
            })}
          </h1>
          <p className="mt-1 text-sm text-text/85 md:text-base">
            {t("dashboard.hero.subtitle", {
              words: integerFormatter.format(stats.words),
              sessions: integerFormatter.format(stats.sessions),
            })}
          </p>
        </div>
      </section>

      <section>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.key}
                className="rounded-lg border border-mid-gray/20 bg-background px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${card.iconClass}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="text-sm font-medium text-text/90">{card.label}</h3>
                </div>
                <p className="mt-3 text-3xl leading-none font-semibold text-text">
                  {card.value}
                </p>
                <p className="mt-1 text-xs text-mid-gray">{card.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="px-4">
          <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
            {t("dashboard.resources.title")}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {resources.map((resource) => {
            const Icon = resource.icon;
            return (
              <button
                type="button"
                key={resource.key}
                className="flex items-center justify-between rounded-lg border border-mid-gray/20 bg-background px-3 py-2 text-left transition-colors hover:bg-logo-primary/10"
                onClick={() => openResource(resource.url)}
              >
                <span className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${resource.iconClass}`} />
                  <span className="text-sm font-medium text-text/90">
                    {resource.label}
                  </span>
                </span>
                <ArrowUpRight className="h-4 w-4 text-mid-gray" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
