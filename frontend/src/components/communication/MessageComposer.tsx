import React, { useState, useRef, useEffect } from 'react';
import {
  Paperclip,
  Smile,
  X,
  UploadCloud,
  Mic,
  Square,
  Play,
  Pause,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatMessage, ContactItem } from '../../store/useCommunicationStore';
import EmojiPickerPopover from './EmojiPickerPopover';
import { uploadChatAttachment } from '../../services/firebase';

interface MessageComposerProps {
  onSendMessage: (content: string, file?: { name: string; url: string; size: number }) => void;
  replyToMessage?: ChatMessage | null;
  onClearReply?: () => void;
  editingMessage?: ChatMessage | null;
  onClearEdit?: () => void;
  contacts: ContactItem[];
  placeholder?: string;
  onTyping?: () => void;
  orgId?: string;
  convId?: string;
  enterToSend?: boolean;
}

export default function MessageComposer({
  onSendMessage,
  replyToMessage,
  onClearReply,
  editingMessage,
  onClearEdit,
  contacts,
  placeholder = 'Type a message... (Press Enter to send)',
  onTyping,
  orgId = 'default-org',
  convId = 'general',
  enterToSend = true,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; url: string; size: number } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // User Mention dropdown state
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');

  // Voice Recording state (Requirement 22: Record, Stop, Preview, Send, Play, Pause, Seek)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Populate text when editing an existing message
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.content);
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  // Auto-resize textarea to fit content without clipping placeholder
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollH, 24), 120)}px`;
    }
  }, [text]);

  // Clean up audio preview URL on unmount or reset
  useEffect(() => {
    return () => {
      if (audioPreviewUrl && audioPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [audioPreviewUrl]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (onTyping) onTyping();

    // Check for @mention trigger
    const lastWord = val.split(/\s+/).pop();
    if (lastWord && lastWord.startsWith('@')) {
      setShowMentionMenu(true);
      setMentionQuery(lastWord.slice(1).toLowerCase());
    } else {
      setShowMentionMenu(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (enterToSend) {
        if (!e.shiftKey) {
          e.preventDefault();
          handleFormSubmit();
        }
      } else {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          handleFormSubmit();
        }
      }
    } else if (e.key === 'Escape') {
      if (onClearReply) onClearReply();
      if (onClearEdit) onClearEdit();
      setShowEmojiPicker(false);
      setShowMentionMenu(false);
      handleDiscardVoice();
    }
  };

  const handleFileSelect = async (file: File) => {
    if (!file) return;

    // Check size limit: 25MB
    const MAX_SIZE = 25 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size is 25MB.`);
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    try {
      const uploaded = await uploadChatAttachment(file, orgId, convId, (pct) => {
        setUploadProgress(pct);
      });

      setAttachedFile({
        name: uploaded.name,
        url: uploaded.url,
        size: uploaded.size,
      });
    } catch (err: any) {
      console.error('File upload error:', err);
      // Fallback local blob URL
      const localUrl = URL.createObjectURL(file);
      setAttachedFile({
        name: file.name,
        url: localUrl,
        size: file.size,
      });
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(null), 500);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFormSubmit = () => {
    if (isUploading) return;

    if (audioBlob) {
      handleSendVoice();
      return;
    }

    if (!text.trim() && !attachedFile) return;

    onSendMessage(text, attachedFile || undefined);
    setText('');
    setAttachedFile(null);
    setShowEmojiPicker(false);
    setShowMentionMenu(false);
    if (onClearReply) onClearReply();
    if (onClearEdit) onClearEdit();
  };

  const insertMention = (memberName: string) => {
    const words = text.split(/\s+/);
    words.pop();
    const newText = [...words, `@${memberName} `].join(' ');
    setText(newText);
    setShowMentionMenu(false);
    textareaRef.current?.focus();
  };

  // ==========================================
  // VOICE MESSAGE FUNCTIONS (Requirement 22)
  // ==========================================
  const handleStartRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Voice recording is not supported in this browser environment.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioPreviewUrl(url);

        // Stop all audio tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.warn('Microphone access denied or error:', err);
      alert('Could not access microphone. Please check your browser permissions.');
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const handleDiscardVoice = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    setAudioBlob(null);
    if (audioPreviewUrl && audioPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(audioPreviewUrl);
    }
    setAudioPreviewUrl(null);
    setIsPlayingPreview(false);
  };

  const handleSendVoice = async () => {
    if (!audioBlob) return;

    try {
      const fileName = `Voice_Note_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
      const audioFile = new File([audioBlob], fileName, { type: audioBlob.type || 'audio/webm' });

      setIsUploading(true);
      const uploaded = await uploadChatAttachment(audioFile, orgId, convId);

      onSendMessage('', {
        name: uploaded.name,
        url: uploaded.url,
        size: uploaded.size,
      });

      handleDiscardVoice();
    } catch (e) {
      console.error('Failed to upload voice note:', e);
      if (audioPreviewUrl) {
        onSendMessage('', {
          name: 'Voice_Note.webm',
          url: audioPreviewUrl,
          size: audioBlob.size,
        });
      }
      handleDiscardVoice();
    } finally {
      setIsUploading(false);
    }
  };

  const togglePreviewPlay = () => {
    if (!previewAudioRef.current) return;
    if (isPlayingPreview) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      previewAudioRef.current.play();
      setIsPlayingPreview(true);
    }
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(mentionQuery)
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`px-2.5 sm:px-3.5 py-2 sm:py-2.5 border-t border-white/[0.06] shrink-0 bg-[#0b141a]/95 sm:bg-[#111b21]/95 backdrop-blur-md relative transition-all select-none ${
        isDraggingOver ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''
      }`}
    >
      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/95 to-indigo-600/95 backdrop-blur-md rounded-2xl flex flex-col items-center justify-center text-white z-50">
          <UploadCloud className="w-8 h-8 animate-bounce mb-1" />
          <p className="font-bold text-xs uppercase tracking-wider">Drop file to attach</p>
        </div>
      )}

      {/* Reply Preview Context Banner */}
      <AnimatePresence>
        {replyToMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 5 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: 5 }}
            className="mb-2 px-3 py-1.5 bg-[#1f2c34]/95 backdrop-blur-xl border-l-4 border-l-blue-500 border-y border-r border-white/10 rounded-xl flex items-center justify-between text-xs text-blue-400 font-medium shadow-md"
          >
            <div className="flex items-center gap-2 truncate">
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-blue-500/20 rounded text-blue-400">
                Replying to {replyToMessage.sender.name}
              </span>
              <span className="truncate italic text-[#d1d7db] font-normal">
                "{replyToMessage.content}"
              </span>
            </div>
            <button
              type="button"
              onClick={onClearReply}
              className="p-1 hover:bg-white/10 rounded-full cursor-pointer transition-colors text-[#8696a0] hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Preview Context Banner */}
      <AnimatePresence>
        {editingMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 5 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: 5 }}
            className="mb-2 px-3 py-1.5 bg-[#1f2c34]/95 backdrop-blur-xl border-l-4 border-l-amber-500 border-y border-r border-white/10 rounded-xl flex items-center justify-between text-xs text-amber-400 font-medium shadow-md"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-amber-500/20 rounded">
                Editing Message
              </span>
              <span className="text-[11px] text-[#8696a0] font-normal">
                (Press Esc to cancel)
              </span>
            </div>
            <button
              type="button"
              onClick={onClearEdit}
              className="p-1 hover:bg-white/10 rounded-full cursor-pointer transition-colors text-[#8696a0] hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attached File Preview Chip */}
      {attachedFile && (
        <div className="mb-2 p-1.5 pr-3 bg-[#1f2c34]/95 backdrop-blur-xl border border-blue-500/40 rounded-2xl flex items-center justify-between text-xs font-semibold text-blue-400 w-fit max-w-sm shadow-md animate-in fade-in">
          <div className="flex items-center gap-2.5 min-w-0">
            {attachedFile.name.match(/\.(png|jpe?g|webp|gif|svg|bmp)$/i) || attachedFile.url.startsWith('data:image/') ? (
              <img
                src={attachedFile.url}
                alt={attachedFile.name}
                className="w-8 h-8 rounded-lg object-cover border border-white/20 shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                <Paperclip className="w-4 h-4 text-blue-400" />
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span className="truncate max-w-[200px] text-[#d1d7db] text-xs font-medium">{attachedFile.name}</span>
              <span className="text-[10px] text-[#8696a0] font-mono">
                {attachedFile.size > 1024 * 1024
                  ? `${(attachedFile.size / (1024 * 1024)).toFixed(1)} MB`
                  : `${Math.round(attachedFile.size / 1024)} KB`}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAttachedFile(null)}
            className="ml-3 p-1 hover:bg-white/10 rounded-full cursor-pointer text-[#8696a0] hover:text-rose-400 transition-colors"
            title="Remove file"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Upload Progress Bar */}
      {uploadProgress !== null && (
        <div className="mb-2 w-full bg-[#111b21] rounded-full h-1 overflow-hidden">
          <div
            className="bg-blue-500 h-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {/* @Mention Suggestion Dropdown */}
      {showMentionMenu && filteredContacts.length > 0 && (
        <div className="absolute left-4 bottom-16 w-60 bg-[#1f2c34] border border-white/10 rounded-2xl p-1.5 shadow-2xl z-50 max-h-40 overflow-y-auto space-y-0.5 backdrop-blur-xl">
          <p className="text-[10px] font-bold uppercase text-[#8696a0] px-2 py-0.5 tracking-wider">
            Mention Teammate
          </p>
          {filteredContacts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => insertMention(c.name)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/5 text-xs font-medium text-[#d1d7db] cursor-pointer transition-colors text-left"
            >
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center">
                {c.name.charAt(0)}
              </span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,.zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            handleFileSelect(f);
          }
          // Reset so selecting the same file again works
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* MODE 1: Active Voice Recording Mode */}
      {isRecording ? (
        <div className="flex gap-2 items-center">
          <div className="flex-1 flex items-center justify-between px-4 py-2 bg-[#1f2c34]/95 backdrop-blur-xl border border-rose-500/40 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.3)] min-h-[46px]">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping" />
              <span className="text-sm font-mono font-bold text-rose-400">
                {formatSeconds(recordingSeconds)}
              </span>
              <span className="text-xs text-[#8696a0] hidden sm:inline">Recording voice note...</span>
            </div>

            <button
              type="button"
              onClick={handleDiscardVoice}
              className="p-1.5 rounded-full text-[#8696a0] hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer"
              title="Discard recording"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Stop / Finish button */}
          <button
            type="button"
            onClick={handleStopRecording}
            className="w-11 h-11 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-[0_4px_16px_rgba(225,29,72,0.4)] flex items-center justify-center shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200"
            title="Stop & preview"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        </div>
      ) : audioPreviewUrl ? (
        /* MODE 2: Voice Note Preview & Send Mode */
        <div className="flex gap-2 items-center">
          <div className="flex-1 flex items-center justify-between gap-3 px-3.5 py-2 bg-[#1f2c34]/95 backdrop-blur-xl border border-blue-500/40 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.3)] min-h-[46px]">
            <audio
              ref={previewAudioRef}
              src={audioPreviewUrl}
              onTimeUpdate={() => setPreviewCurrentTime(previewAudioRef.current?.currentTime || 0)}
              onLoadedMetadata={() => setPreviewDuration(previewAudioRef.current?.duration || 0)}
              onEnded={() => setIsPlayingPreview(false)}
              className="hidden"
            />

            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <button
                type="button"
                onClick={togglePreviewPlay}
                className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/25 flex items-center justify-center shrink-0 cursor-pointer shadow-sm transition-transform active:scale-95"
                title={isPlayingPreview ? 'Pause' : 'Play'}
              >
                {isPlayingPreview ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              {/* Seek Bar / Progress Waveform */}
              <div className="flex-1 flex flex-col justify-center">
                <input
                  type="range"
                  min={0}
                  max={previewDuration || 1}
                  step={0.1}
                  value={previewCurrentTime}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setPreviewCurrentTime(val);
                    if (previewAudioRef.current) previewAudioRef.current.currentTime = val;
                  }}
                  className="w-full h-1 bg-[#202c33] rounded-lg accent-blue-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#8696a0] font-mono mt-0.5">
                  <span>{formatSeconds(previewCurrentTime)}</span>
                  <span>{formatSeconds(previewDuration || recordingSeconds)}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDiscardVoice}
              className="p-1.5 rounded-full text-[#8696a0] hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer shrink-0"
              title="Delete voice note"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Elevated Circular Send Button */}
          <button
            type="button"
            onClick={handleSendVoice}
            disabled={isUploading}
            className="w-11 h-11 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-[0_4px_16px_rgba(59,130,246,0.4)] flex items-center justify-center shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200"
            title="Send voice message"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current ml-0.5">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      ) : (
        /* MODE 3: Normal Text & Attachment Composer - VARIANT 1 WHATSAPP GLASS PILL */
        <div className="flex gap-2 items-end">
          {/* WhatsApp Floating Stadium Capsule */}
          <div className="flex-1 flex items-end bg-[#1f2c34]/95 backdrop-blur-xl border border-white/10 hover:border-white/15 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30 rounded-[24px] sm:rounded-full px-2 py-1 shadow-[0_2px_8px_rgba(0,0,0,0.3)] transition-all min-h-[46px]">
            {/* Emoji Button */}
            <div className="relative shrink-0 mb-0.5">
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer hover:bg-white/5 active:scale-95 text-[#8696a0] hover:text-[#d1d7db]"
                title="Insert Emoji"
              >
                <Smile className="w-5 h-5" />
              </button>

              {/* Emoji Popover */}
              <AnimatePresence>
                {showEmojiPicker && (
                  <EmojiPickerPopover
                    onSelectEmoji={(emoji) => setText((prev) => prev + emoji)}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* File Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all cursor-pointer hover:bg-white/5 active:scale-95 ${
                attachedFile ? 'text-blue-400' : 'text-[#8696a0] hover:text-[#d1d7db]'
              }`}
              title="Attach Document or Image (or Drag & Drop)"
            >
              <Paperclip className="w-5 h-5 -rotate-45" />
            </button>

            {/* Text Area Input */}
            <div className="flex-1 relative flex items-center min-w-0 my-auto py-1">
              <textarea
                ref={textareaRef}
                rows={1}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-full bg-transparent border-0 outline-none text-[#e9edef] placeholder:text-[#8696a0] font-normal text-sm sm:text-[15px] leading-5 resize-none px-2 py-1 max-h-32 min-h-[24px]"
              />
            </div>
          </div>

          {/* Elevated Circular Action Button (Mic or Send) */}
          <div className="shrink-0 mb-0.5">
            <AnimatePresence mode="wait">
              {text.trim() || attachedFile ? (
                <motion.button
                  key="send-btn"
                  initial={{ scale: 0.8, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0.8, rotate: 20, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  type="button"
                  onClick={handleFormSubmit}
                  disabled={isUploading}
                  className="w-11 h-11 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-[0_4px_16px_rgba(59,130,246,0.4)] flex items-center justify-center cursor-pointer hover:scale-105 active:scale-95 transition-transform duration-150"
                  title="Send message"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5 text-white fill-white ml-0.5"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </motion.button>
              ) : (
                <motion.button
                  key="mic-btn"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  type="button"
                  onClick={handleStartRecording}
                  className="w-11 h-11 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-[0_4px_16px_rgba(59,130,246,0.4)] flex items-center justify-center cursor-pointer hover:scale-105 active:scale-95 transition-transform duration-150"
                  title="Record voice message"
                >
                  <Mic className="w-5 h-5 stroke-[2.2]" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
