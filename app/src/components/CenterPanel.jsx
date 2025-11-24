import React, { useState, useEffect, useRef } from "react";
import ControlsBar from "./ControlsBar";
import ChartArea from "./ChartArea";
import ChartContainer from "./ChartContainer";
import { api } from "../utils/api";
import { USE_OAKVIEW_CHART } from "../config";

export default function CenterPanel({ currentSession, sessionData, setSessionData, isLoading, onLoadingChange, onSelectSession, chartType, setChartType, timeframe, setTimeframe }) {
  const [previewData, setPreviewData] = useState(null);
  const chartRef = useRef(null);
  const providerRef = useRef(null); // For OakView provider

  // Load preview data when session is selected
  useEffect(() => {
    const loadPreviewData = async () => {
      if (!currentSession) {
        setPreviewData(null);
        return;
      }

      // Clear preview if playback has started
      if (sessionData.stats?.quoteCount > 0) {
        setPreviewData(null);
        return;
      }

      try {
        console.log('📊 Loading preview data for:', currentSession.id);
        onLoadingChange?.(true);
        const data = await api.loadSessionData(currentSession.id);

        // Limit preview to max 10,000 ticks to prevent memory issues
        const MAX_PREVIEW_TICKS = 10000;
        let previewSample = data;

        if (data.length > MAX_PREVIEW_TICKS) {
          console.log(`⚠️ Large dataset (${data.length.toLocaleString()} ticks), sampling every ${Math.ceil(data.length / MAX_PREVIEW_TICKS)}th tick for preview`);
          const step = Math.ceil(data.length / MAX_PREVIEW_TICKS);
          previewSample = [];
          for (let i = 0; i < data.length; i += step) {
            previewSample.push(data[i]);
          }
          console.log(`✅ Preview sample: ${previewSample.length.toLocaleString()} ticks`);
        }

        setPreviewData(previewSample);
        console.log('✅ Preview data loaded:', previewSample.length, 'ticks (full session:', data.length.toLocaleString(), 'ticks)');
      } catch (err) {
        console.error('❌ Failed to load preview data:', err);
      } finally {
        onLoadingChange?.(false);
      }
    };

    loadPreviewData();
  }, [currentSession, sessionData.stats?.quoteCount, onLoadingChange]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#131722]">
      {/* Chart Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {USE_OAKVIEW_CHART ? (
          <ChartContainer
            ref={chartRef}
            currentSession={currentSession}
            sessionData={sessionData}
            isLoading={isLoading}
            chartType={chartType}
            timeframe={timeframe}
            providerRef={providerRef}
            onSessionSelect={onSelectSession}
          />
        ) : (
          <ChartArea
            ref={chartRef}
            sessionData={sessionData}
            isLoading={isLoading}
            chartType={chartType}
            timeframe={timeframe}
            previewData={previewData}
          />
        )}
      </div>

      {/* Controls Bar */}
      {currentSession && (
        <div className="flex-shrink-0">
          <ControlsBar
            currentSession={currentSession}
            sessionData={sessionData}
            setSessionData={setSessionData}
            onLoadingChange={onLoadingChange}
            providerRef={USE_OAKVIEW_CHART ? providerRef : null}
            chartRef={chartRef}
            onSelectSession={onSelectSession}
          />
        </div>
      )}
    </div>
  );
}