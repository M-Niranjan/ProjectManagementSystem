import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, RotateCcw } from 'lucide-react';

export type MessageDeliveryStatus =
  | 'sending'
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

interface MessageStatusProps {
  status?: MessageDeliveryStatus | string;
  isRead?: boolean;
  isMe?: boolean;
  className?: string;
  onRetry?: () => void;
  showFailedAction?: boolean;
}

/**
 * Premium, custom-built WhatsApp-style message delivery status indicator.
 * Displays:
 *  - Sending: Animated subtle rotating ring ○
 *  - Sent: Single gray checkmark ✓
 *  - Delivered: Double gray checkmark ✓✓
 *  - Read: Double blue checkmark ✓✓ (#53bdeb)
 *  - Failed: Red alert with optional retry button
 * Fully accessible with title tooltips and aria-labels.
 */
export const MessageStatus: React.FC<MessageStatusProps> = ({
  status,
  isRead = false,
  isMe = true,
  className = '',
  onRetry,
  showFailedAction = true,
}) => {
  if (!isMe) return null;

  // Auto-resolve any prolonged 'sending' status to 'sent' after 3.5s so spinners never get stuck
  const [currentStatus, setCurrentStatus] = React.useState(status);

  React.useEffect(() => {
    setCurrentStatus(status);
    if (status === 'sending' || status === 'pending') {
      const timer = setTimeout(() => {
        setCurrentStatus('sent');
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Determine effective status
  let effectiveStatus: MessageDeliveryStatus = 'sent';

  if (currentStatus === 'failed') {
    effectiveStatus = 'failed';
  } else if (currentStatus === 'sending' || currentStatus === 'pending') {
    effectiveStatus = 'sending';
  } else if (isRead || currentStatus === 'read') {
    effectiveStatus = 'read';
  } else if (currentStatus === 'delivered') {
    effectiveStatus = 'delivered';
  } else {
    effectiveStatus = 'sent';
  }

  return (
    <div
      className={`inline-flex items-center gap-1 select-none ${className}`}
      role="status"
      aria-label={`Message status: ${effectiveStatus}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {effectiveStatus === 'sending' && (
          <motion.span
            key="sending"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-center shrink-0"
            title="Sending message..."
          >
            {/* Custom animated sending circle */}
            <svg
              className="w-3 h-3 text-[#8696a0] animate-spin"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeDasharray="28"
                strokeDashoffset="12"
                strokeLinecap="round"
                className="opacity-75"
              />
            </svg>
          </motion.span>
        )}

        {effectiveStatus === 'sent' && (
          <motion.span
            key="sent"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="flex items-center shrink-0 text-[#8696a0]"
            title="Sent ✓"
          >
            {/* Single gray checkmark */}
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3.2 8.2l3.2 3.4 6.8-7.2" />
            </svg>
          </motion.span>
        )}

        {effectiveStatus === 'delivered' && (
          <motion.span
            key="delivered"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="flex items-center shrink-0 text-[#8696a0]"
            title="Delivered ✓✓"
          >
            {/* Double gray checkmark */}
            <svg
              className="w-4 h-3.5"
              viewBox="0 0 19 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1.5 8.2l3.2 3.4 6.8-7.2" />
              <path d="M6.2 8.2l3.2 3.4 6.8-7.2" />
            </svg>
          </motion.span>
        )}

        {effectiveStatus === 'read' && (
          <motion.span
            key="read"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="flex items-center shrink-0 text-[#53bdeb]"
            title="Read ✓✓"
          >
            {/* Double WhatsApp blue checkmark */}
            <svg
              className="w-4 h-3.5"
              viewBox="0 0 19 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1.5 8.2l3.2 3.4 6.8-7.2" />
              <path d="M6.2 8.2l3.2 3.4 6.8-7.2" />
            </svg>
          </motion.span>
        )}

        {effectiveStatus === 'failed' && (
          <motion.span
            key="failed"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1 shrink-0 text-rose-400"
            title="Failed to send"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
            {showFailedAction && (
              <span className="text-[10px] font-semibold text-rose-400">Failed</span>
            )}
            {showFailedAction && onRetry && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry();
                }}
                className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-300 hover:text-white underline cursor-pointer ml-0.5"
                title="Retry sending message"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Retry
              </button>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MessageStatus;
