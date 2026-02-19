import React, { useState } from 'react';
import { StepIndicator } from './StepIndicator';
import { ScreenWelcome } from './ScreenWelcome';
import { ScreenPermissions } from './ScreenPermissions';
import { ScreenModelSelection } from './ScreenModelSelection';
import { ScreenVoiceTest } from './ScreenVoiceTest';
import { ScreenTranscriptionTest } from './ScreenTranscriptionTest';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const totalSteps = 5;

  const nextStep = () => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-text overflow-hidden select-none font-sans">
        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0 relative">
            {step === 0 && <ScreenWelcome onNext={nextStep} />}
            {step === 1 && <ScreenPermissions onNext={nextStep} />}
            {step === 2 && <ScreenModelSelection onNext={nextStep} />}
            {step === 3 && <ScreenVoiceTest onNext={nextStep} />}
            {step === 4 && <ScreenTranscriptionTest onNext={nextStep} />}
        </div>

        {/* Footer with steps */}
        <div className="pb-6 pt-3 flex justify-center shrink-0">
            <StepIndicator totalSteps={totalSteps} currentStep={step} />
        </div>
    </div>
  );
};
