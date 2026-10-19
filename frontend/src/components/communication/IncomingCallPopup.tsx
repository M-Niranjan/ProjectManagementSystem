import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Video, Sparkles } from 'lucide-react';
import { useCallStore } from '../../store/useCallStore';

export const IncomingCallPopup: React.FC = () => {
  const incomingCall = useCallStore((s) => s.incomingCall);
  const acceptCall = useCallStore((s) => s.acceptCall);
  const rejectCall = useCallStore((s) => s.rejectCall);

  if (!incomingCall) return null;

  const isVideo = incomingCall.callType === 'video';

  return (
    <AnimatePresence>
      <div className="fixed top-6 right-4 sm:right-6 z-[99999] pointer-events-auto max-w-[92vw] w-96">
        <motion.div
          initial={{ opacity: 0, y: -30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.9 }}
          transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          className="relative overflow-hidden rounded-2xl bg-[#1e293b]/95 border border-blue-500/30 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.65),0_0_30px_rgba(59,130,246,0.3)] backdrop-blur-xl text-white"
        >
          {/* Glowing Animated Ambient Rim */}
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500 rounded-2xl blur-sm opacity-20 -z-10 animate-pulse pointer-events-none" />

          <div className="flex items-center gap-3.5">
            {/* Caller Avatar with Ringing Pulse */}
            <div className="relative shrink-0">
              <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-blue-500/80 shadow-lg bg-[#0f172a] flex items-center justify-center">
                {incomingCall.callerAvatar ? (
                  <img
                    src={incomingCall.callerAvatar}
                    alt={incomingCall.callerName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-lg font-bold text-blue-300">
                    {incomingCall.callerName?.charAt(0)?.toUpperCase() || 'U'}
                  </span>
                )}
              </div>
              <span className="absolute -inset-1 rounded-full ring-2 ring-emerald-400 animate-ping opacity-60 pointer-events-none" />
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#1e293b] flex items-center justify-center text-white text-[10px]">
                {isVideo ? <Video className="w-2.5 h-2.5" /> : <Phone className="w-2.5 h-2.5" />}
              </div>
            </div>

            {/* Caller Info & Badges */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  Incoming {isVideo ? 'Video' : 'Audio'} Call
                </span>
              </div>
              <h4 className="text-base font-bold text-white truncate mt-1">
                {incomingCall.callerName}
              </h4>
              <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Ringing...</span>
              </p>
            </div>
          </div>

          {/* Action Buttons: Accept (Green) and Reject (Red) */}
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-700/60">
            <button
              onClick={rejectCall}
              className="flex-1 py-2.5 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-600 border border-rose-500/40 hover:border-rose-600 text-rose-300 hover:text-white text-xs font-bold flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer active:scale-95 shadow-md"
              title="Decline Call"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Decline</span>
            </button>

            <button
              onClick={acceptCall}
              className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-[0_4px_15px_rgba(16,185,129,0.4)] active:scale-95 animate-pulse"
              title="Accept Call"
            >
              <Phone className="w-4 h-4 fill-current" />
              <span>Accept</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default IncomingCallPopup;
