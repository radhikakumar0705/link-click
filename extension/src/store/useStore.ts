import { create } from 'zustand';
import type { LinkListItem, PublicUser } from '../api/client';

export type Tab = 'shorten' | 'history' | 'analytics' | 'settings';
export type View = 'main' | 'login';

interface AppStore {
  user: PublicUser | null;
  setUser: (user: PublicUser | null) => void;

  links: LinkListItem[];
  setLinks: (links: LinkListItem[]) => void;

  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;

  view: View;
  setView: (view: View) => void;

  lastResult: { shortUrl: string; shortCode: string } | null;
  setLastResult: (result: { shortUrl: string; shortCode: string } | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  links: [],
  setLinks: (links) => set({ links }),

  activeTab: 'shorten',
  setActiveTab: (activeTab) => set({ activeTab }),

  view: 'main',
  setView: (view) => set({ view }),

  lastResult: null,
  setLastResult: (lastResult) => set({ lastResult }),
}));
