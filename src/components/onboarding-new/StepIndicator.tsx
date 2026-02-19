import React from 'react';

interface StepIndicatorProps {
  totalSteps: number;
  currentStep: number;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({ totalSteps, currentStep }) => {
  return (
    <div className="flex items-center gap-3">
      {Array.from({ length: totalSteps }).map((_, index) => (
        <div
          key={index}
          className={`h-2 w-2 rounded-full transition-all duration-500 ${
            index === currentStep
              ? 'bg-logo-primary scale-110'
              : 'bg-gray-400 opacity-40'
          }`}
        />
      ))}
    </div>
  );
};
