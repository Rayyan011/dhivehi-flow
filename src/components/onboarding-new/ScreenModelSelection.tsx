import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import ModelCard from "../onboarding/ModelCard";
import { useModelStore } from "@/stores/modelStore";
import { BaukaloCharacter } from "./BaukaloCharacter";
import { Button } from "@/components/ui/Button";

interface ScreenModelSelectionProps {
  onNext: () => void;
}

export const ScreenModelSelection: React.FC<ScreenModelSelectionProps> = ({ onNext }) => {
  const { t } = useTranslation();
  const {
    models,
    downloadModel,
    selectModel,
    downloadingModels,
    extractingModels,
    downloadProgress,
    downloadStats,
  } = useModelStore();
  
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSelectingModel, setIsSelectingModel] = useState(false);

  const isDownloading = downloadingId !== null;
  const getDhivehiPreferredModel = () => models.find((m) => m.id === "whisper-small-dv");

  // Set initial selection
  useEffect(() => {
      if (!selectedId && !isDownloading) {
          const preferred = getDhivehiPreferredModel();
          if (preferred) {
            setSelectedId(preferred.id);
            return;
          }
          const rec = models.find((m) => m.id === "whisper-small-dv");
          if (rec) setSelectedId(rec.id);
      }
  }, [models, selectedId, isDownloading]);

  // Watch for the downloading model to finish
  useEffect(() => {
    if (!downloadingId) return;

    const model = models.find((m) => m.id === downloadingId);
    const stillDownloading = downloadingId in downloadingModels;
    const stillExtracting = downloadingId in extractingModels;

    if (
      model?.is_downloaded &&
      !stillDownloading &&
      !stillExtracting &&
      !isSelectingModel
    ) {
      // Model is ready — select it and transition
      setIsSelectingModel(true);
      selectModel(downloadingId).then((success) => {
        if (success) {
          onNext();
        } else {
          toast.error(t("onboarding.errors.selectModel"));
          setDownloadingId(null);
          setIsSelectingModel(false);
        }
      });
    }
  }, [
    downloadingId,
    models,
    downloadingModels,
    extractingModels,
    isSelectingModel,
    selectModel,
    onNext,
    t,
  ]);

  const handleDownloadModel = async (modelId: string) => {
    setDownloadingId(modelId);

    const success = await downloadModel(modelId);
    if (!success) {
      toast.error(t("onboarding.downloadFailed"));
      setDownloadingId(null);
      setIsSelectingModel(false);
    }
  };

  const handleCardClick = (id: string) => {
      if (!isDownloading) setSelectedId(id);
  };

  const handleContinue = () => {
      if (!selectedId) return;
      handleDownloadModel(selectedId);
  };

  const getCardStatus = (modelId: string) => {
      if (modelId in extractingModels) return "extracting";
      if (modelId in downloadingModels) return "downloading";
      if (modelId === selectedId) return "active";
      return "available";
  };

  // On onboarding, only expose the Dhivehi Whisper model.
  const displayModels = models.filter((m) => m.id === "whisper-small-dv");

  return (
    <div className="flex flex-col items-center h-full w-full py-5 animate-in fade-in duration-500 min-h-0">
      <div className="flex-1 flex flex-col items-center w-full max-w-md gap-5 overflow-hidden px-4 min-h-0">
        <BaukaloCharacter pose="eager" className="shrink-0" />

        <div className="text-center mb-2 shrink-0">
          <h1 className="text-lg font-semibold italic text-logo-primary">
            {t("onboardingNew.modelSelection.speech")}
          </h1>
        </div>

        <div className="w-full space-y-3 pb-3 overflow-y-auto scrollbar-hide">
          {displayModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              variant={model.is_recommended ? "featured" : "default"}
              status={getCardStatus(model.id)}
              compact
              disabled={isDownloading && model.id !== downloadingId}
              onSelect={handleCardClick}
              onDownload={handleCardClick} // Override download to select
              downloadProgress={downloadProgress[model.id]?.percentage}
              downloadSpeed={downloadStats[model.id]?.speed}
              showRecommended={true}
            />
          ))}
        </div>
      </div>

      <div className="w-full max-w-md px-4 mt-auto shrink-0">
          <Button 
            onClick={handleContinue} 
            disabled={isDownloading || !selectedId} 
            className="w-full h-12 text-base transition-all"
            size="lg"
          >
            {isDownloading
              ? t("onboarding.downloading")
              : t("onboardingNew.modelSelection.cta")}
          </Button>
      </div>
    </div>
  );
};
