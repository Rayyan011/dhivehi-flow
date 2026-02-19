import React from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { baukaloAnimation } from "@/assets/lotties";

const HandyTextLogo = ({
  width,
  height,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => {
  const resolvedWidth = width ?? height ?? 120;
  const resolvedHeight = height ?? width ?? 120;

  return (
    <div
      className={className}
      style={{
        width: resolvedWidth,
        height: resolvedHeight,
        maxWidth: "100%",
      }}
      aria-label="Baukalo logo"
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

export default HandyTextLogo;
