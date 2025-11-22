import React, { useState } from 'react';
import SetupScreen from './components/SetupScreen';
import LiveSession from './components/LiveSession';
import { AppState, InterviewConfig } from './types';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SETUP);
  const [config, setConfig] = useState<InterviewConfig | null>(null);

  const handleStartInterview = (newConfig: InterviewConfig) => {
    setConfig(newConfig);
    setAppState(AppState.LIVE);
  };

  const handleEndInterview = () => {
    setAppState(AppState.SETUP);
    // In a real app, you would go to SUMMARY state here
    setConfig(null);
  };

  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30">
      {appState === AppState.SETUP && (
        <SetupScreen onStart={handleStartInterview} />
      )}
      
      {appState === AppState.LIVE && config && (
        <LiveSession config={config} onEnd={handleEndInterview} />
      )}
    </div>
  );
};

export default App;