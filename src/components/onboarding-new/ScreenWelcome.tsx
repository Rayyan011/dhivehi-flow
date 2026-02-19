import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { BaukaloCharacter } from './BaukaloCharacter';

interface ScreenWelcomeProps {
  onNext: () => void;
}

export const ScreenWelcome: React.FC<ScreenWelcomeProps> = ({ onNext }) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-between h-full w-full py-5 animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <BaukaloCharacter pose="peek" />

        <div className="text-center space-y-3 max-w-sm px-6">
          <h1 className="text-xl font-semibold italic text-logo-primary">
            {t('onboardingNew.welcome.speech')}
          </h1>
          <p className="text-lg text-text font-medium">
            {t('onboardingNew.welcome.subtitle')}
          </p>
          <p className="text-sm text-text/60 italic">
            {t('onboardingNew.welcome.aside')}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 w-full mt-auto">
        <Button onClick={onNext} className="w-64 h-12 text-base" size="lg">
          {t('onboardingNew.welcome.cta')}
        </Button>
      </div>
    </div>
  );
};
