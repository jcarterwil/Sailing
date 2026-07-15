"use client";

import { createContext, useContext, type ReactNode } from "react";

type HelpUiContextValue = {
  /** When false, HelpTip expands in-place instead of linking to /help/metrics. */
  glossaryLink: boolean;
};

const HelpUiContext = createContext<HelpUiContextValue>({ glossaryLink: true });

export function HelpUiProvider({
  glossaryLink = true,
  children,
}: {
  glossaryLink?: boolean;
  children: ReactNode;
}) {
  return (
    <HelpUiContext.Provider value={{ glossaryLink }}>
      {children}
    </HelpUiContext.Provider>
  );
}

export function useHelpUi(): HelpUiContextValue {
  return useContext(HelpUiContext);
}
