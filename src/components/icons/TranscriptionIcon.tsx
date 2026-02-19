import React, { useEffect, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import type { DotLottie } from "@lottiefiles/dotlottie-react";
import { runningCatAnimation } from "@/assets/lotties";

interface TranscriptionIconProps {
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  animated?: boolean;
}

const TranscriptionIcon: React.FC<TranscriptionIconProps> = ({
  width = 32,
  height = 32,
  className = "",
  animated = true,
}) => {
  const [dotLottie, setDotLottie] = useState<DotLottie | null>(null);

  useEffect(() => {
    if (!dotLottie) return;
    if (animated) {
      dotLottie.play();
    } else {
      dotLottie.pause();
    }
  }, [animated, dotLottie]);

  return (
    <DotLottieReact
      src={runningCatAnimation}
      loop
      dotLottieRefCallback={setDotLottie}
      className={className}
      style={{ width, height }}
    />
  );
};

export default TranscriptionIcon;
