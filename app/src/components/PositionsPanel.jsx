import React from "react";
export default function PositionsPanel() {
  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800 px-5 py-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-green-400">Position Summary</h2>
      </div>
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <span>Position summary coming soon...</span>
      </div>
    </div>
  );
}