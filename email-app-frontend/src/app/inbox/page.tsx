'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useCompose } from '@/contexts/ComposeContext';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';
import {
  ArrowRightOnRectangleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import io from 'socket.io-client';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import EmailMessage from '@/components/EmailMessage';
import { ComposeProvider } from '@/contexts/ComposeContext';
import { ThreadMsg, ThreadsResponse } from '@/types/email';
import { RingLoader } from 'react-spinners';

const ComposeCard = dynamic(() => import('@/components/ComposeCard'), { ssr: false });

function InboxContent() {
  const [loading, setLoading] = useState(true);
  const { user, logout, loading: authLoading } = useAuth();
  const { addWindow, windows, canAddWindow } = useCompose();
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadMsg[][]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const socketRef = useRef<ReturnType<typeof io>>(null);
  const listRef = useRef<HTMLUListElement>(null);

  async function handleDownload(messageId: string, filename: string) {
    try {
      const response = await api.get<Blob>(
        `/api/email/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(filename)}`,
        { responseType: 'blob' }
      );
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      alert('Download failed');
    }
  }

  async function handleReply(message: ThreadMsg, content: string) {
    try {
      await api.post('/api/email/send', {
        to: message.from,
        subject: `Re: ${message.subject}`,
        body: content,
        inReplyTo: message.messageId,
        references: [message.messageId, ...(message.references || [])],
      });
      // Refresh the thread
      const response = await api.get<ThreadsResponse>('/api/email/threads', { params: { limit: 20 } });
      setThreads(response.data.threads);
    } catch (error) {
      console.error('Failed to send reply:', error);
      throw error;
    }
  }

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!authLoading) {
      setLoading(true);
      api
        .get<ThreadsResponse>('/api/email/threads', { params: { limit: 20 } })
        .then((response) => setThreads(response.data.threads))
        .finally(() => setLoading(false));

      if (!socketRef.current) {
        const accessToken = localStorage.getItem('accessToken');
        if (!accessToken) {
          console.error('No access token found');
          return;
        }

        socketRef.current = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000', {
          auth: { token: accessToken },
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000
        });

        socketRef.current.on('connect_error', (error: Error) => {
          console.error('Socket connection error:', error);
          if (error.message === 'Authentication failed') {
            router.push('/login');
          }
        });

        socketRef.current.on('new_email', (email: ThreadMsg) => {
          setThreads((prev) => {
            if (prev.some((t) => t[0].messageId === email.messageId)) return prev;
            setHighlightId(email.messageId);
            setTimeout(() => setHighlightId(null), 5000);
            listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            return [[email], ...prev];
          });
        });
      }
    }

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [authLoading, user, router]);

  const handleCompose = () => {
    if (canAddWindow) {
      addWindow();
    } else {
      alert('Maximum number of compose windows reached (5)');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white space-y-4 animate-fadeIn">
        <Image
          src="/logo.png"
          alt="Logo"
          width={40}
          height={40}
          className="opacity-70 animate-pulse drop-shadow-[0_0_8px_#6366f1]"
        />
        <RingLoader color="#6366f1" size={60} />
        <p className="text-sm text-slate-400">Fetching your inbox...</p>
      </div>
    );
  }

  return (
    <main className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      <aside className="w-80 border-r border-slate-800 p-5 flex flex-col h-full overflow-hidden">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Image src="/logo.png" alt="Logo" width={24} height={24} />
            <h1 className="text-xl font-semibold">Inbox</h1>
          </div>
          <button
            onClick={logout}
            className="p-1 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
          >
            <ArrowRightOnRectangleIcon className="h-6 w-6" />
          </button>
        </header>

        <button
          onClick={handleCompose}
          disabled={!canAddWindow}
          className="mb-4 w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <PencilSquareIcon className="h-4 w-4" /> Compose
        </button>

        {loading ? (
          <p className="text-slate-400">Fetching your data…</p>
        ) : (
          <ul
            ref={listRef}
            className="space-y-2 overflow-y-auto flex-1 pr-1 scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-transparent"
          >
            {threads.map((t, idx) => {
              const first = t[0];
              const snippet = first.text?.slice(0, 50).replace(/\s+/g, ' ') || '';
              const isActive = active === idx;
              const isNew = first.messageId === highlightId;
              return (
                <motion.li
                  key={first.messageId}
                  onClick={() => setActive(idx)}
                  whileHover={{ scale: 1.02 }}
                  className={`cursor-pointer rounded-md p-3 transition-all ${isActive
                      ? 'bg-indigo-500/20 ring-1 ring-indigo-400'
                      : 'hover:bg-slate-800/60'
                    } ${isNew ? 'ring-2 ring-green-400/70' : ''}`}
                >
                  <p className="truncate font-medium">{first.subject || '(no subject)'}</p>
                  <p className="truncate text-xs text-slate-400">{first.from}</p>
                  <p className="truncate text-xs text-slate-500">
                    {snippet}
                    {first.attachments?.length ? (
                      <span className="ml-1 text-slate-400">📎</span>
                    ) : null}
                  </p>
                </motion.li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          {active !== null ? (
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ type: 'tween', duration: 0.1 }}
              className="max-w-4xl space-y-6"
            >
              {threads[active].map((message, index) => (
                <EmailMessage
                  key={message.messageId}
                  message={message}
                  onReply={(content) => handleReply(message, content)}
                  onDownload={handleDownload}
                  isLastInThread={index === threads[active].length - 1}
                />
              ))}
            </motion.div>
          ) : (
            <motion.p
              key="placeholder"
              className="text-slate-400"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              Select a thread to read
            </motion.p>
          )}
        </AnimatePresence>
      </section>

      <AnimatePresence>
        {windows.map((window) => (
          <ComposeCard
            key={window.id}
            windowId={window.id}
            afterSend={async () => {
              const response = await api.get<ThreadsResponse>('/api/email/threads', { params: { limit: 20 } });
              setThreads(response.data.threads);
            }}
          />
        ))}
      </AnimatePresence>
    </main>
  );
}

export default function Inbox() {
  return (
    <ComposeProvider>
      <InboxContent />
    </ComposeProvider>
  );
}
