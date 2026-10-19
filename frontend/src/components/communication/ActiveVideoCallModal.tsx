import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Maximize2,
  Minimize2,
  AlertCircle,
  Volume2,
  Sparkles,
} from 'lucide-react';
import { useCallStore } from '../../store/useCallStore';

export const ActiveVideoCallModal: React.FC = () => {
  const activeCall = useCallStore((s) => s.activeCall);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const isMuted = useCallStore((s) => s.isMuted);
  const isVideoOff = useCallStore((s) => s.isVideoOff);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleVideo = useCallStore((s) => s.toggleVideo);
  const endCall = useCallStore((s) => s.endCall);
  const dismissError = useCallStore((s) => s.dismissError);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pipPosition, setPipPosition] = useState<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'>('bottom-right');

  // Attach local media stream to local video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch((err) => {
        console.warn('Local video playback auto-play error:', err);
      });
    }
  }, [localStream, isVideoOff]);

  // Attach remote media stream to remote video element
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch((err) => {
        console.warn('Remote video playback auto-play error:', err);
      });
    }
  }, [remoteStream]);

  if (!activeCall) return null;

  const isVideoCall = activeCall.callType === 'video';
  const otherPersonName =
    activeCall.role === 'caller' ? activeCall.receiverName : activeCall.callerName;
  const otherPersonAvatar =
    activeCall.role === 'caller' ? activeCall.receiverAvatar : activeCall.callerAvatar;

  // Real connection status
  const isRinging = activeCall.status === 'ringing';
  const isConnecting = activeCall.status === 'connecting';
  const isConnected = activeCall.status === 'connected';

  // Format call duration strictly from activeCall.duration (which only increments when connected)
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const hasRemoteVideo =
    isVideoCall &&
    Boolean(
      remoteStream &&
      remoteStream.getVideoTracks().length > 0 &&
      remoteStream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live')
    );

  const hasLocalVideo =
    isVideoCall &&
    !isVideoOff &&
    Boolean(
      localStream &&
      localStream.getVideoTracks().length > 0 &&
      localStream.getVideoTracks().some((t) => t.enabled)
    );

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const pipPosClasses = {
    'bottom-right': 'bottom-20 right-4 sm:bottom-24 sm:right-6',
    'bottom-left': 'bottom-20 left-4 sm:bottom-24 sm:left-6',
    'top-right': 'top-20 right-4 sm:top-24 sm:right-6',
    'top-left': 'top-20 left-4 sm:top-24 sm:left-6',
  }[pipPosition];

  const cyclePipPosition = () => {
    const positions: Array<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'> = [
      'bottom-right',
      'bottom-left',
      'top-left',
      'top-right',
    ];
    const currentIndex = positions.indexOf(pipPosition);
    setPipPosition(positions[(currentIndex + 1) % positions.length]);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[99990] flex items-center justify-center p-0 sm:p-4 md:p-6 bg-black/90 backdrop-blur-xl select-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className={`relative flex flex-col bg-[#0f172a] overflow-hidden shadow-2xl border border-slate-700/50 ${
            isFullscreen
              ? 'w-full h-full rounded-none'
              : 'w-full max-w-5xl h-[100dvh] sm:h-[88vh] max-h-[850px] sm:rounded-3xl'
          }`}
        >
          {/* Top Bar Header */}
          <div className="absolute top-0 left-0 right-0 z-30 p-4 sm:p-5 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center">
                {otherPersonAvatar ? (
                  <img
                    src={otherPersonAvatar}
                    alt={otherPersonName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-bold text-blue-400">
                    {otherPersonName?.charAt(0)?.toUpperCase() || 'U'}
                  </span>
                )}
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white leading-tight">
                  {otherPersonName}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  {isRinging && (
                    <span className="text-xs text-amber-400 font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      Ringing...
                    </span>
                  )}
                  {isConnecting && (
                    <span className="text-xs text-blue-400 font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                      Connecting WebRTC stream...
                    </span>
                  )}
                  {isConnected && (
                    <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Connected • {formatDuration(activeCall.duration)}
                    </span>
                  )}
                  {activeCall.status === 'ended' && (
                    <span className="text-xs text-slate-400">Call Ended</span>
                  )}
                  {activeCall.status === 'rejected' && (
                    <span className="text-xs text-rose-400">Call Declined</span>
                  )}
                </div>
              </div>
            </div>

            {/* Top Right Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700/50 backdrop-blur-md"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* MAIN VIEWPORT: REMOTE PARTICIPANT */}
          <div className="relative flex-1 w-full h-full bg-[#0b1120] flex items-center justify-center overflow-hidden">
            {/* Live Remote Video Feed */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                hasRemoteVideo && isConnected ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
              }`}
            />

            {/* Remote Avatar Fallback (Shown when camera is off, call is audio-only, or stream is connecting) */}
            {(!hasRemoteVideo || !isConnected) && (
              <div className="flex flex-col items-center justify-center p-6 text-center select-none">
                <div className="relative mb-6">
                  <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden ring-4 ring-blue-500/30 shadow-[0_0_60px_rgba(59,130,246,0.35)] bg-slate-800 flex items-center justify-center">
                    {otherPersonAvatar ? (
                      <img
                        src={otherPersonAvatar}
                        alt={otherPersonName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-4xl font-bold text-blue-400">
                        {otherPersonName?.charAt(0)?.toUpperCase() || 'U'}
                      </span>
                    )}
                  </div>

                  {/* Pulsing rings when ringing or connecting */}
                  {(isRinging || isConnecting) && (
                    <>
                      <span className="absolute -inset-3 rounded-full ring-2 ring-blue-400/50 animate-ping opacity-50" />
                      <span className="absolute -inset-6 rounded-full ring-2 ring-indigo-400/30 animate-pulse" />
                    </>
                  )}
                </div>

                <h2 className="text-xl sm:text-2xl font-bold text-white">{otherPersonName}</h2>
                <p className="text-sm text-slate-400 mt-1 max-w-sm">
                  {isRinging && 'Waiting for participant to answer...'}
                  {isConnecting && 'Establishing direct peer-to-peer media stream...'}
                  {isConnected && !isVideoCall && 'Audio Call in progress'}
                  {isConnected && isVideoCall && 'Participant camera is turned off'}
                </p>
              </div>
            )}

            {/* PICTURE-IN-PICTURE (PiP): LOCAL WEBCAM FEED */}
            {isVideoCall && (
              <div
                onClick={cyclePipPosition}
                title="Click to reposition camera preview"
                className={`absolute z-30 ${pipPosClasses} w-32 h-44 sm:w-44 sm:h-60 rounded-2xl overflow-hidden border-2 border-blue-500/50 shadow-[0_10px_35px_rgba(0,0,0,0.7)] bg-slate-900 cursor-pointer transition-all duration-300 hover:scale-105 group`}
              >
                {/* Mirrored Local Video Feed */}
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover -scale-x-100 transition-opacity duration-300 ${
                    hasLocalVideo ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
                  }`}
                />

                {/* Local Camera Off / Placeholder */}
                {!hasLocalVideo && (
                  <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-slate-800 text-slate-400">
                    <VideoOff className="w-6 h-6 text-slate-500 mb-1" />
                    <span className="text-[11px] font-semibold text-slate-400">Camera Off</span>
                  </div>
                )}

                {/* PiP Badge */}
                <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[9px] font-semibold text-white">
                  You {isMuted && '• Muted'}
                </div>
              </div>
            )}
          </div>

          {/* HARDWARE PERMISSION / ERROR BANNER */}
          {activeCall.errorMessage && (
            <div className="absolute top-18 left-4 right-4 z-40 p-3 rounded-xl bg-rose-900/90 border border-rose-500/60 text-white flex items-center justify-between text-xs sm:text-sm shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-rose-300 shrink-0" />
                <span>{activeCall.errorMessage}</span>
              </div>
              <button
                onClick={dismissError}
                className="px-2 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* BOTTOM FLOATING CONTROL DOCK */}
          <div className="absolute bottom-0 left-0 right-0 z-30 p-4 sm:p-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-center">
            <div className="flex items-center gap-4 sm:gap-6 px-6 py-3 rounded-full bg-slate-900/90 border border-slate-700/60 shadow-2xl backdrop-blur-xl">
              {/* Microphone Mute Toggle */}
              <button
                onClick={toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shadow-md active:scale-95 ${
                  isMuted
                    ? 'bg-rose-500 hover:bg-rose-600 text-white ring-4 ring-rose-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700'
                }`}
                title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* Video Camera Toggle */}
              {isVideoCall && (
                <button
                  onClick={toggleVideo}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shadow-md active:scale-95 ${
                    isVideoOff
                      ? 'bg-rose-500 hover:bg-rose-600 text-white ring-4 ring-rose-500/30'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700'
                  }`}
                  title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
                >
                  {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
              )}

              {/* End Call Button */}
              <button
                onClick={endCall}
                className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-[0_0_25px_rgba(225,29,72,0.5)] transition-all duration-200 cursor-pointer hover:scale-110 active:scale-95"
                title="End Call"
              >
                <PhoneOff className="w-6 h-6" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ActiveVideoCallModal;
