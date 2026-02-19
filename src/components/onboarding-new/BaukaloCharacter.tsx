import React from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { baukaloAnimation } from "@/assets/lotties";

export type BaukaloPose =
  | "peek"
  | "fidget"
  | "perk"
  | "cool"
  | "eager"
  | "listen"
  | "celebrate";

interface BaukaloCharacterProps {
  pose: BaukaloPose;
  className?: string;
}

export const BaukaloCharacter: React.FC<BaukaloCharacterProps> = ({ pose, className }) => {
  return (
    <div
      className={`relative flex items-center justify-center w-[clamp(136px,30vh,210px)] h-[clamp(136px,30vh,210px)] ${className}`}
      aria-label={`Baukalo ${pose}`}
    >
      <DotLottieReact
        src={baukaloAnimation}
        autoplay
        loop
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};
