import React from "react";

export default function LoadingSpinner({ message = "Loading..." }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#131722]/95 backdrop-blur-sm z-20">
      <div className="relative">
        {/* Outer rotating ring - TradingView blue */}
        <div className="w-16 h-16 border-3 border-[#2A2E39] border-t-[#2962FF] rounded-full animate-spin"></div>

        {/* Inner pulsing circle */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <div className="w-8 h-8 bg-[#2962FF]/20 rounded-full animate-pulse"></div>
        </div>
      </div>

      <div className="mt-5 text-center">
        <p className="text-[#B2B5BE] font-medium text-[13px]">{message}</p>
        <p className="text-[#787B86] text-[11px] mt-1">Processing session data...</p>
      </div>
    </div>
  );
}