import React, { useState } from "react";
import { useSettings } from "../contexts/SettingsContext";

export default function SettingsPanel() {
  const { settings, updateSetting, resetSettings } = useSettings();
  const [recordingShortcut, setRecordingShortcut] = useState(null);

  const handleShortcutRecord = (settingKey) => {
    setRecordingShortcut(settingKey);
  };

  const handleKeyDown = (e, settingKey) => {
    if (recordingShortcut !== settingKey) return;

    e.preventDefault();
    e.stopPropagation();

    const modifiers = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.altKey) modifiers.push('Alt');
    if (e.metaKey) modifiers.push('Meta');

    // Get the key (ignore modifier keys themselves)
    const key = e.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return;

    // Build shortcut string
    const shortcut = [...modifiers, key.toUpperCase()].join('+');

    updateSetting(settingKey, shortcut);
    setRecordingShortcut(null);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800 px-5 py-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-green-400">⚙️ Settings</h2>
        <button
          onClick={resetSettings}
          className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
        >
          Reset All
        </button>
      </div>

      <div className="space-y-6">
        {/* Trading Shortcuts */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-gray-300 border-b border-gray-700 pb-2">
            🎮 Trading Shortcuts
          </h3>

          <div className="space-y-3">
            {/* Buy Shortcut */}
            <div>
              <label className="text-sm text-gray-400 block mb-1">Buy Shortcut</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={recordingShortcut === 'buyShortcut' ? 'Press keys...' : settings.buyShortcut}
                  readOnly
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  onClick={() => handleShortcutRecord('buyShortcut')}
                  onKeyDown={(e) => handleKeyDown(e, 'buyShortcut')}
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                    recordingShortcut === 'buyShortcut'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-white'
                  }`}
                >
                  {recordingShortcut === 'buyShortcut' ? 'Recording...' : 'Record'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Click Record and press your desired key combination</p>
            </div>

            {/* Sell Shortcut */}
            <div>
              <label className="text-sm text-gray-400 block mb-1">Sell Shortcut</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={recordingShortcut === 'sellShortcut' ? 'Press keys...' : settings.sellShortcut}
                  readOnly
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <button
                  onClick={() => handleShortcutRecord('sellShortcut')}
                  onKeyDown={(e) => handleKeyDown(e, 'sellShortcut')}
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                    recordingShortcut === 'sellShortcut'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-white'
                  }`}
                >
                  {recordingShortcut === 'sellShortcut' ? 'Recording...' : 'Record'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Click Record and press your desired key combination</p>
            </div>
          </div>
        </div>

        {/* Order Book Settings */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-gray-300 border-b border-gray-700 pb-2">
            📖 Order Book
          </h3>

          <div>
            <label className="text-sm text-gray-400 block mb-1">Depth Levels</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="5"
                max="30"
                value={settings.orderBookDepth}
                onChange={(e) => updateSetting('orderBookDepth', Number(e.target.value))}
                className="flex-1"
              />
              <input
                type="number"
                min="5"
                max="30"
                value={settings.orderBookDepth}
                onChange={(e) => updateSetting('orderBookDepth', Number(e.target.value))}
                className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">Number of bid/ask levels to display (minimum: 5)</p>
          </div>
        </div>
      </div>
    </div>
  );
}