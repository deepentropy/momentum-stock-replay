import React, { createContext, useContext, useState, useEffect } from 'react';

const LayoutContext = createContext();

const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'sidebar', x: 0, y: 0, w: 3, h: 12, minW: 2, maxW: 4, static: false },
    { i: 'chart', x: 3, y: 0, w: 7, h: 12, minW: 4, minH: 6 },
    { i: 'orderbook', x: 10, y: 0, w: 2, h: 12, minW: 2, maxW: 4, minH: 6 },
  ],
};

export function LayoutProvider({ children }) {
  const [layouts, setLayouts] = useState(() => {
    const saved = localStorage.getItem('tradingAppLayout');
    return saved ? JSON.parse(saved) : DEFAULT_LAYOUTS;
  });

  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    localStorage.setItem('tradingAppLayout', JSON.stringify(layouts));
  }, [layouts]);

  const updateLayout = (newLayout) => {
    setLayouts({ lg: newLayout });
  };

  const resetLayout = () => {
    setLayouts(DEFAULT_LAYOUTS);
  };

  const toggleEditMode = () => {
    setIsEditMode(prev => !prev);
  };

  return (
    <LayoutContext.Provider value={{
      layouts,
      updateLayout,
      resetLayout,
      isEditMode,
      toggleEditMode
    }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutProvider');
  }
  return context;
}