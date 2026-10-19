import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  List,
  ClipboardCheck,
  Settings as SettingsIcon,
  X,
  CheckSquare,
  FolderGit2,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '../store/useUIStore';
import { useAuthStore } from '../store/useAuthStore';
import { useCommunicationStore } from '../store/useCommunicationStore';
import { getDashboardPathForRole } from '../services/authRoles';

export default function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { setProjectModalOpen, setTaskModalOpen, setPomodoroTimer } = useUIStore();
  const { unreadCounts } = useCommunicationStore();
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close quick action sheet when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setShowCreateSheet(false);
      }
    };
    if (showCreateSheet) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCreateSheet]);

  const totalUnreadMessages = Object.values(unreadCounts || {}).reduce((sum, count) => sum + count, 0);

  // Active tab detection
  const isDashboardActive = location.pathname === '/' || location.pathname.includes('/dashboard');
  const isTasksActive =
    location.pathname.startsWith('/tasks') ||
    location.pathname.startsWith('/my-tasks');
  const isChatActive = location.pathname === '/messages';
  const isSettingsActive =
    location.pathname.startsWith('/settings') ||
    location.pathname.startsWith('/organization');

  const activeTabIndex = isDashboardActive
    ? 0
    : isTasksActive
    ? 1
    : isChatActive
    ? 2
    : isSettingsActive
    ? 3
    : -1;

  const [isInMobileChat, setIsInMobileChat] = useState(() =>
    typeof document !== 'undefined' && document.body.classList.contains('mobile-chat-open')
  );

  useEffect(() => {
    const handleChatState = () => {
      setIsInMobileChat(document.body.classList.contains('mobile-chat-open'));
    };
    window.addEventListener('mobile-chat-state-changed', handleChatState);
    return () => window.removeEventListener('mobile-chat-state-changed', handleChatState);
  }, []);

  // When active chat conversation is open on mobile, hide the bottom pill dock so it doesn't block the message composer
  if (isChatActive && isInMobileChat) {
    return null;
  }

  const handleDashboardClick = () => {
    setShowCreateSheet(false);
    const target = getDashboardPathForRole(user?.role) || '/dashboard';
    if (location.pathname !== target && !location.pathname.endsWith('/dashboard')) {
      navigate(target);
    }
  };

  const handleTasksClick = () => {
    setShowCreateSheet(false);
    if (!location.pathname.startsWith('/tasks') && !location.pathname.startsWith('/my-tasks')) {
      navigate('/tasks');
    }
  };

  const handleChatClick = () => {
    setShowCreateSheet(false);
    if (location.pathname !== '/messages') {
      navigate('/messages');
    }
  };

  const handleSettingsClick = () => {
    setShowCreateSheet(false);
    if (!location.pathname.startsWith('/settings')) {
      navigate('/settings');
    }
  };

  return (
    <>
      {/* Quick Action Sheet Modal */}
      <AnimatePresence>
        {showCreateSheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs sm:hidden"
              onClick={() => setShowCreateSheet(false)}
            />
            <motion.div
              ref={sheetRef}
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-24 left-4 right-4 z-50 rounded-2xl bg-white dark:bg-[#121624] border border-slate-200 dark:border-white/10 p-3 shadow-2xl sm:hidden"
            >
              <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b border-slate-100 dark:border-white/5">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">Quick Actions</span>
                <button
                  onClick={() => setShowCreateSheet(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-1.5 pt-1">
                <button
                  onClick={() => {
                    setShowCreateSheet(false);
                    setTaskModalOpen(true);
                  }}
                  className="w-full p-2.5 rounded-xl flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-white/5 text-left transition-colors cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                    <CheckSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">Create New Task</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Assign milestone steps & deliverables</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowCreateSheet(false);
                    setProjectModalOpen(true);
                  }}
                  className="w-full p-2.5 rounded-xl flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-white/5 text-left transition-colors cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                    <FolderGit2 className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">Create New Project</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Initiate workspace projects & boards</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowCreateSheet(false);
                    setPomodoroTimer(true);
                  }}
                  className="w-full p-2.5 rounded-xl flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-white/5 text-left transition-colors cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">Focus Timer</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Pomodoro focus sprint timer</p>
                  </div>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* iOS / Android Floating Pill Bottom Navigation Bar */}
      <div className="sm:hidden fixed bottom-[max(0.85rem,env(safe-area-inset-bottom,0.85rem))] left-3.5 right-3.5 z-40 max-w-sm mx-auto pointer-events-none select-none">
        <nav
          aria-label="Mobile Navigation Pill"
          className="pointer-events-auto h-[64px] p-1.5 rounded-full bg-slate-900/85 dark:bg-[#0a0f1d]/90 backdrop-blur-2xl border border-white/15 dark:border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] dark:shadow-[0_16px_42px_rgba(0,0,0,0.7)] flex items-center relative overflow-hidden select-none"
        >
          {/* Inner Unified 4-Tab Track */}
          <div className="relative w-full h-full flex items-center">
            {/* Sliding Active Capsule - Option 3: Concentric Squircle (rounded-[22px]) */}
            {activeTabIndex !== -1 && (
              <motion.div
                initial={false}
                animate={{
                  left: `${activeTabIndex * 25}%`,
                }}
                transition={{ type: 'spring', damping: 28, stiffness: 350 }}
                className="absolute inset-y-0 w-1/4 pointer-events-none z-0 p-[2px]"
              >
                <div className="w-full h-full rounded-[22px] bg-gradient-to-b from-white/[0.15] to-white/[0.04] backdrop-blur-md border border-white/20 shadow-[0_2px_10px_rgba(0,0,0,0.25),inset_0_1px_1px_rgba(255,255,255,0.22)]" />
              </motion.div>
            )}

            {/* Tab 1: Dashboard */}
            <button
              onClick={handleDashboardClick}
              className="relative z-10 w-1/4 h-full flex flex-col items-center justify-center cursor-pointer outline-none focus:outline-none select-none active:scale-95 transition-transform"
            >
              <LayoutGrid
                className={`w-[22px] h-[22px] transition-colors ${
                  isDashboardActive
                    ? 'text-white stroke-[2.2]'
                    : 'text-slate-400 dark:text-slate-400 group-hover:text-white stroke-[1.8]'
                }`}
              />
              <span
                className={`text-[11px] mt-1 tracking-tight transition-colors ${
                  isDashboardActive
                    ? 'text-white font-medium'
                    : 'text-slate-400 dark:text-slate-400 font-normal'
                }`}
              >
                Dashboard
              </span>
            </button>

            {/* Tab 2: Tasks */}
            <button
              onClick={handleTasksClick}
              className="relative z-10 w-1/4 h-full flex flex-col items-center justify-center cursor-pointer outline-none focus:outline-none select-none active:scale-95 transition-transform"
            >
              <List
                className={`w-[22px] h-[22px] transition-colors ${
                  isTasksActive
                    ? 'text-white stroke-[2.2]'
                    : 'text-slate-400 dark:text-slate-400 group-hover:text-white stroke-[1.8]'
                }`}
              />
              <span
                className={`text-[11px] mt-1 tracking-tight transition-colors ${
                  isTasksActive
                    ? 'text-white font-medium'
                    : 'text-slate-400 dark:text-slate-400 font-normal'
                }`}
              >
                Tasks
              </span>
            </button>

            {/* Tab 3: Chat */}
            <button
              onClick={handleChatClick}
              className="relative z-10 w-1/4 h-full flex flex-col items-center justify-center cursor-pointer outline-none focus:outline-none select-none active:scale-95 transition-transform"
            >
              <div className="relative">
                <svg
                  className={`w-[22px] h-[22px] transition-colors ${
                    isChatActive
                      ? 'text-white'
                      : 'text-slate-400 dark:text-slate-400 group-hover:text-white'
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={isChatActive ? 2.2 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 21l1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
                </svg>

                {totalUnreadMessages > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 bg-[#ef4444] text-white text-[10px] font-black rounded-full flex items-center justify-center ring-2 ring-white dark:ring-[#111b21] shadow-sm animate-pulse">
                    {totalUnreadMessages > 99 ? '99+' : totalUnreadMessages}
                  </span>
                )}
              </div>
              <span
                className={`text-[11px] mt-1 tracking-tight transition-colors ${
                  isChatActive
                    ? 'text-white font-medium'
                    : 'text-slate-400 dark:text-slate-400 font-normal'
                }`}
              >
                Chat
              </span>
            </button>

            {/* Tab 4: Settings */}
            <button
              onClick={handleSettingsClick}
              className="relative z-10 w-1/4 h-full flex flex-col items-center justify-center cursor-pointer outline-none focus:outline-none select-none active:scale-95 transition-transform"
            >
              <SettingsIcon
                className={`w-[22px] h-[22px] transition-colors ${
                  isSettingsActive
                    ? 'text-white stroke-[2.2]'
                    : 'text-slate-400 dark:text-slate-400 group-hover:text-white stroke-[1.8]'
                }`}
              />
              <span
                className={`text-[11px] mt-1 tracking-tight transition-colors ${
                  isSettingsActive
                    ? 'text-white font-medium'
                    : 'text-slate-400 dark:text-slate-400 font-normal'
                }`}
              >
                Settings
              </span>
            </button>
          </div>
        </nav>
      </div>
    </>
  );
}
