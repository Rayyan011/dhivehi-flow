import React from "react";

const HandyTextLogo = ({
  width,
  height,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        maxWidth: "100%",
      }}
    >
      <div
        className="text-center font-semibold tracking-wide text-text"
        style={{
          lineHeight: 1.2,
          fontSize: "clamp(20px, 4vw, 36px)",
        }}
      >
        Dhivehi Flow
      </div>
    </div>
  );
};

export default HandyTextLogo;
