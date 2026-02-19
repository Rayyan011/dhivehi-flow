import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { platform } from '@tauri-apps/plugin-os';
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkMicrophonePermission,
  requestMicrophonePermission,
} from 'tauri-plugin-macos-permissions-api';
import { toast } from 'sonner';
import { commands } from '@/bindings';
import { useSettingsStore } from '@/stores/settingsStore';
import { Loader2, Mic, Keyboard, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BaukaloCharacter, BaukaloPose } from './BaukaloCharacter';

interface ScreenPermissionsProps {
  onNext: () => void;
}

export const ScreenPermissions: React.FC<ScreenPermissionsProps> = ({ onNext }) => {
  const { t } = useTranslation();
  const refreshAudioDevices = useSettingsStore(state => state.refreshAudioDevices);
  const refreshOutputDevices = useSettingsStore(state => state.refreshOutputDevices);
  const [isMacOS, setIsMacOS] = useState<boolean>(false);
  const [permissions, setPermissions] = useState<{
    accessibility: 'needed' | 'waiting' | 'granted';
    microphone: 'needed' | 'waiting' | 'granted';
  }>({
    accessibility: 'needed',
    microphone: 'needed',
  });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const didInitializeRef = useRef(false);

  useEffect(() => {
    const currentPlatform = platform();
    const isMac = currentPlatform === 'macos';
    setIsMacOS(isMac);
    
    const checkInitial = async () => {
      try {
        if (isMac) {
             const [accessibilityGranted, microphoneGranted] = await Promise.all([
              checkAccessibilityPermission(),
              checkMicrophonePermission(),
            ]);
            setPermissions({
                accessibility: accessibilityGranted ? 'granted' : 'needed',
                microphone: microphoneGranted ? 'granted' : 'needed',
            });
        } else {
             // Non-macOS: Assume accessibility is not needed (granted)
             // We still want to ask for Mic if possible, or just assume it needs granting via OS dialog
             // We'll mark it as needed to show the UI
             setPermissions({
                 accessibility: 'granted', 
                 microphone: 'needed',
             });
        }
      } catch (e) {
        console.error("Permission check failed", e);
      }
    };
    checkInitial();
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
        try {
            if (isMacOS) {
                const [accessibilityGranted, microphoneGranted] = await Promise.all([
                    checkAccessibilityPermission(),
                    checkMicrophonePermission(),
                ]);
                
                setPermissions(prev => {
                    const next = { ...prev };
                    if (accessibilityGranted) next.accessibility = 'granted';
                    if (microphoneGranted) next.microphone = 'granted';
                    return next;
                });

                 if (accessibilityGranted && microphoneGranted) {
                    if (pollingRef.current) {
                        clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }
                    // Initialize things when granted
                    try {
                        await Promise.all([
                          commands.initializeEnigo(),
                          commands.initializeShortcuts(),
                          refreshAudioDevices(),
                          refreshOutputDevices()
                        ]);
                    } catch (e) {
                        console.warn("Init failed", e);
                    }
                 }
            } else {
                // Non-macOS polling logic if needed
                // For now we might just rely on manual grant button logic
            }
        } catch (e) {
            console.error(e);
        }
    }, 1000);
  }, [isMacOS, refreshAudioDevices, refreshOutputDevices]);

  useEffect(() => {
      return () => {
          if (pollingRef.current) clearInterval(pollingRef.current);
      }
  }, []);
  
  const handleGrantAccessibility = async () => {
      if (!isMacOS) return;
      try {
          await requestAccessibilityPermission();
          setPermissions(prev => ({ ...prev, accessibility: 'waiting' }));
          startPolling();
      } catch (e) {
          toast.error(t('onboardingNew.permissions.errors.requestFailed'));
      }
  };

  const handleGrantMicrophone = async () => {
      try {
           if (isMacOS) {
              await requestMicrophonePermission();
              setPermissions(prev => ({ ...prev, microphone: 'waiting' }));
              startPolling();
           } else {
               // Non-macOS: Simulate grant or try to initialize
               // Maybe check if we can list devices?
               try {
                   await refreshAudioDevices();
                   setPermissions(prev => ({ ...prev, microphone: 'granted' }));
               } catch (e) {
                   // If that fails, maybe we can't get permission this way
                   // But let's assume success for the sake of the UI flow on Windows/Linux for now
                   // as requestMicrophonePermission isn't available
                   setPermissions(prev => ({ ...prev, microphone: 'granted' }));
               }
           }
      } catch (e) {
          console.error(e);
          toast.error(t('onboardingNew.permissions.errors.requestFailed'));
      }
  };

  const allGranted = permissions.accessibility === 'granted' && permissions.microphone === 'granted';

  useEffect(() => {
    if (!allGranted || didInitializeRef.current) return;
    didInitializeRef.current = true;

    Promise.all([
      commands.initializeEnigo(),
      commands.initializeShortcuts(),
      refreshAudioDevices(),
      refreshOutputDevices(),
    ]).catch((e) => {
      didInitializeRef.current = false;
      console.warn("Onboarding runtime initialization failed", e);
    });
  }, [allGranted, refreshAudioDevices, refreshOutputDevices]);

  // Baukalo pose logic
  let pose: BaukaloPose = 'fidget';
  if (allGranted) {
      pose = 'cool';
  } else if (permissions.accessibility === 'granted' || permissions.microphone === 'granted') {
      pose = 'perk';
  }

  return (
    <div className="flex flex-col items-center justify-between h-full w-full py-5 animate-in fade-in duration-500 min-h-0">
      <div className="flex-1 flex flex-col items-center justify-start gap-5 w-full max-w-md px-4 min-h-0 overflow-y-auto">
        <BaukaloCharacter pose={pose} />

        <div className="text-center space-y-2 mb-1">
            <h1 className="text-lg font-semibold italic text-logo-primary min-h-[1.5rem] transition-all">
                {allGranted ? t('onboardingNew.permissions.speechAfter') : t('onboardingNew.permissions.speechBefore')}
            </h1>
        </div>

        <div className="w-full space-y-4 pb-3">
             {/* Microphone Card */}
             <div className="bg-surface/50 border border-border rounded-xl p-4 flex items-center gap-4 shadow-sm transition-all hover:border-logo-primary/30">
                 <div className="p-3 bg-logo-primary/10 rounded-full text-logo-primary">
                    <Mic className="w-5 h-5" />
                 </div>
                 <div className="flex-1">
                     <h3 className="font-semibold text-text">{t('onboardingNew.permissions.microphone.title')}</h3>
                     <p className="text-sm text-text/60">{t('onboardingNew.permissions.microphone.description')}</p>
                 </div>
                 {permissions.microphone === 'granted' ? (
                     <div className="text-green-500 font-medium flex items-center gap-1">
                         <Check className="w-4 h-4" />
                         <span className="text-sm">{t('onboardingNew.permissions.microphone.granted')}</span>
                     </div>
                 ) : (
                     <Button
                        onClick={handleGrantMicrophone} 
                        disabled={permissions.microphone === 'waiting'}
                        size="sm"
                        className="min-w-[80px]"
                     >
                         {permissions.microphone === 'waiting' ? <Loader2 className="animate-spin w-4 h-4" /> : t('onboardingNew.permissions.microphone.grant')}
                     </Button>
                 )}
             </div>

             {/* Accessibility Card (macOS only) */}
             {isMacOS && (
                 <div className="bg-surface/50 border border-border rounded-xl p-4 flex items-center gap-4 shadow-sm transition-all hover:border-logo-primary/30">
                     <div className="p-3 bg-logo-primary/10 rounded-full text-logo-primary">
                        <Keyboard className="w-5 h-5" />
                     </div>
                     <div className="flex-1">
                         <h3 className="font-semibold text-text">{t('onboardingNew.permissions.accessibility.title')}</h3>
                         <p className="text-sm text-text/60">{t('onboardingNew.permissions.accessibility.description')}</p>
                     </div>
                     {permissions.accessibility === 'granted' ? (
                         <div className="text-green-500 font-medium flex items-center gap-1">
                             <Check className="w-4 h-4" />
                             <span className="text-sm">{t('onboardingNew.permissions.accessibility.granted')}</span>
                         </div>
                     ) : (
                         <Button 
                            onClick={handleGrantAccessibility} 
                            disabled={permissions.accessibility === 'waiting'}
                            size="sm"
                            className="min-w-[80px]"
                         >
                             {permissions.accessibility === 'waiting' ? <Loader2 className="animate-spin w-4 h-4" /> : t('onboardingNew.permissions.accessibility.grant')}
                         </Button>
                     )}
                 </div>
             )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 w-full mt-auto shrink-0">
        <Button onClick={onNext} disabled={!allGranted} className="w-64 h-12 text-base" size="lg">
          {t('onboardingNew.permissions.cta')}
        </Button>
      </div>
    </div>
  );
};
