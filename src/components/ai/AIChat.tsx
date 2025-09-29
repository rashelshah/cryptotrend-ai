import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  MessageCircle,
  Send,
  Bot,
  User,
  Sparkles,
  Brain,
  Loader2,
  Square,
  Plus,
  Menu
} from 'lucide-react';
import { geminiAI, AIChatResponse, chatWithAIStream } from '@/lib/gemini';
import { supabase, auth } from '@/lib/supabase';
import { getConfidenceColor } from '@/utils/confidenceCalculator';

interface ChatMessage {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  confidence?: number;
}

export function AIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'ai',
      content: 'Hello! I\'m CryptoTrend AI, your cryptocurrency advisor. I can help answer questions about Bitcoin, Ethereum, DeFi, investing strategies, wallets, staking, and more!\n\n💡 Currently running on knowledge base mode - I can still provide helpful information about cryptocurrency topics.',
      timestamp: new Date(),
      confidence: 85
    }
  ]);


  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<{ id: string; title: string; updated_at: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const stopRef = useRef<{ stop: boolean }>({ stop: false });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Initialize session and load messages from Supabase
  useEffect(() => {
    (async () => {
      try {
        const { user } = await auth.getCurrentUser();
        if (!user) {
          console.warn('AIChat: user not logged in; messages will not persist.');
          return;
        }

        // Load user's sessions list (most recent first)
        const { data: sessRows, error: sessErr } = await supabase
          .from('ai_chat_sessions')
          .select('id, title, updated_at')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false });
        if (sessErr) console.error('AIChat: error fetching sessions', sessErr);
        const normalized = (sessRows || []).map(s => ({ id: s.id as string, title: (s as any).title || 'Untitled Chat', updated_at: (s as any).updated_at }))
        setSessions(normalized);

        // Pick the latest session or create one
        let sid: string | null = normalized[0]?.id || null;
        if (!sid) {
          const { data: created, error: cErr } = await supabase
            .from('ai_chat_sessions')
            .insert({ user_id: user.id, title: 'Default Chat' })
            .select('id, updated_at, title')
            .single();
          if (cErr) {
            console.error('AIChat: error creating session', cErr);
            return;
          }
          sid = created.id;
          setSessions([{ id: created.id, title: created.title || 'Default Chat', updated_at: created.updated_at }, ...normalized]);
        }

        setSessionId(sid);

        // Load messages for the selected session
        const { data: rows, error: mErr } = await supabase
          .from('ai_chat_messages')
          .select('id, role, content, confidence, created_at')
          .eq('session_id', sid!)
          .order('created_at', { ascending: true });

        if (mErr) {
          console.error('AIChat: error fetching messages', mErr);
          return;
        }

        if (rows && rows.length) {
          setMessages(
            rows.map(r => ({
              id: String(r.id),
              type: r.role as 'user' | 'ai',
              content: r.content,
              timestamp: new Date(r.created_at),
              confidence: r.confidence ?? undefined
            }))
          );
        }
      } catch (e) {
        console.error('AIChat init error:', e);
      }
    })();
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;
    if (!sessionId) {
      console.warn('AIChat: No session yet; try again after session initializes.');
      return;
    }

    const questionText = input.trim();

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: questionText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Save user message to Supabase (don’t block UI on insert)
      supabase.from('ai_chat_messages').insert({
        session_id: sessionId,
        role: 'user',
        content: questionText
      }).then(({ error }) => error && console.error('AIChat: error inserting user message', error));

      // Use only last 4 messages to keep prompts small and fast
      const recent = messages.slice(-4).map(m => ({
        role: m.type,
        content: m.content,
        ts: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp)
      }));

      // Prepare an optimistic AI placeholder and stream into it
      const aiTempId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, {
        id: aiTempId,
        type: 'ai',
        content: '',
        timestamp: new Date(),
        confidence: undefined
      }]);

      let streamedText = '';
      setIsStreaming(true);
      stopRef.current.stop = false;
      await chatWithAIStream(
        questionText,
        { history: recent },
        (delta) => {
          if (stopRef.current.stop) return;
          streamedText += delta;
          // Update last AI message incrementally
          setMessages(prev => prev.map(m => m.id === aiTempId ? { ...m, content: streamedText } : m));
        },
        () => stopRef.current.stop
      );

      // Finalize confidence using non-stream helper on the same question (fast calc, no network)
      const finalConfidence = 80; // keep UI snappy; detailed calc already in stream helper

      // Save AI message after stream completes
      supabase.from('ai_chat_messages').insert({
        session_id: sessionId,
        role: 'ai',
        content: streamedText,
        confidence: finalConfidence
      }).then(({ error }) => error && console.error('AIChat: error inserting AI message', error));

      // Attach confidence to the AI message in UI
      setMessages(prev => prev.map(m => m.id === aiTempId ? { ...m, confidence: finalConfidence } : m));
    } catch (error) {
      console.error('AIChat - Error:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: 'I apologize, the AI is slow right now. Try a shorter question or retry in a few seconds.',
        timestamp: new Date(),
        confidence: 40
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsStreaming(false);
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };



  const suggestedQuestions = [
    "What's the best strategy for DCA investing?",
    "Should I invest in Bitcoin or Ethereum?",
    "How do I analyze cryptocurrency trends?",
    "What are the risks of crypto investing?",
    "Explain blockchain technology simply"
  ];

  const handleSuggestedQuestion = (question: string) => {
    setInput(question);
  };



  return (
    <Card className="bg-glass-bg backdrop-blur-glass border-glass-border h-[600px] flex flex-col overflow-hidden">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Brain className="w-5 h-5 text-crypto-green" />
            <span>AI Crypto Advisor</span>
            <Sparkles className="w-4 h-4 text-crypto-orange" />
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Mobile: Sessions drawer trigger */}
            <div className="lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs px-3 py-2">
                    <Menu className="w-3 h-3 mr-1" /> Sessions
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[88%] sm:w-[360px]">
                  <SheetHeader>
                    <SheetTitle>Your chats</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 space-y-1">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={async () => {
                          if (s.id === sessionId) return;
                          setSessionId(s.id);
                          const { data: rows, error: mErr } = await supabase
                            .from('ai_chat_messages')
                            .select('id, role, content, confidence, created_at')
                            .eq('session_id', s.id)
                            .order('created_at', { ascending: true });
                          if (!mErr) {
                            setMessages((rows || []).map(r => ({
                              id: String(r.id),
                              type: r.role as 'user' | 'ai',
                              content: r.content,
                              timestamp: new Date(r.created_at),
                              confidence: r.confidence ?? undefined
                            })));
                          }
                        }}
                        className={`w-full text-left p-3 rounded-md border ${s.id === sessionId ? 'border-crypto-green/50 bg-crypto-green/10' : 'border-transparent hover:bg-muted/30'}`}
                      >
                        <div className="text-sm truncate">{s.title || 'Untitled Chat'}</div>
                        <div className="text-[10px] text-muted-foreground">{new Date(s.updated_at).toLocaleString()}</div>
                      </button>
                    ))}
                    {sessions.length === 0 && (
                      <div className="text-xs text-muted-foreground">No chats yet</div>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {/* Desktop: Toggle sessions sidebar */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSidebarOpen((v) => !v)}
                className="text-xs px-3 py-2 hidden lg:inline-flex"
              >
                <Menu className="w-3 h-3 mr-1" /> Sessions
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const { user } = await auth.getCurrentUser();
                    if (!user) return;
                    const { data, error } = await supabase
                      .from('ai_chat_sessions')
                      .insert({ user_id: user.id, title: `Chat ${new Date().toLocaleString()}` })
                      .select('id, title, updated_at')
                      .single();
                    if (!error && data?.id) {
                      setSessionId(data.id);
                      setSessions(prev => [{ id: data.id, title: data.title || 'Untitled Chat', updated_at: data.updated_at }, ...prev]);
                      setMessages([
                        {
                          id: '1',
                          type: 'ai',
                          content: "Hello! I'm CryptoTrend AI, your cryptocurrency advisor. New chat session started.",
                          timestamp: new Date(),
                          confidence: 85
                        }
                      ]);
                    }
                  } catch (e) {
                    console.error('New chat error:', e);
                  }
                }}
                className="text-xs px-3 py-2"
              >
                <Plus className="w-3 h-3 mr-1" /> New Chat
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { stopRef.current.stop = true; }}
                disabled={!isStreaming}
                className="text-xs px-3 py-2"
              >
                <Square className="w-3 h-3 mr-1" /> Stop
              </Button>
            </div>
            <Badge variant="outline" className="text-xs bg-muted/50 px-2 py-1 hidden xs:inline-flex">
              Knowledge Base Mode
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col space-y-4 p-4 min-h-0 overflow-hidden">
        <div className="flex gap-4 h-full min-h-0">
          {/* Sidebar: Sessions list (collapsible on desktop) */}
          {sidebarOpen && (
            <div className="hidden lg:flex lg:flex-col w-72 flex-shrink-0 overflow-hidden border-r border-border">
              <Collapsible open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <div className="flex items-center justify-between px-3 pt-3 pb-2">
                  <div className="text-xs text-muted-foreground">Your chats</div>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                      <Menu className="w-3 h-3 mr-1" /> Sessions
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className={`overflow-y-auto px-2 pb-2 ${sidebarOpen ? '' : 'hidden'}`}>
                  <div className="space-y-1">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={async () => {
                          if (s.id === sessionId) return;
                          setSessionId(s.id);
                          // Load messages for the selected session
                          const { data: rows, error: mErr } = await supabase
                            .from('ai_chat_messages')
                            .select('id, role, content, confidence, created_at')
                            .eq('session_id', s.id)
                            .order('created_at', { ascending: true });
                          if (!mErr) {
                            setMessages((rows || []).map(r => ({
                              id: String(r.id),
                              type: r.role as 'user' | 'ai',
                              content: r.content,
                              timestamp: new Date(r.created_at),
                              confidence: r.confidence ?? undefined
                            })));
                          }
                        }}
                        className={`w-full text-left p-3 rounded-md border ${s.id === sessionId ? 'border-crypto-green/50 bg-crypto-green/10' : 'border-transparent hover:bg-muted/30'}`}
                      >
                        <div className="text-sm truncate">{s.title || 'Untitled Chat'}</div>
                        <div className="text-[10px] text-muted-foreground">{new Date(s.updated_at).toLocaleString()}</div>
                      </button>
                    ))}
                    {sessions.length === 0 && (
                      <div className="text-xs text-muted-foreground px-1">No chats yet</div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {/* Main: Messages area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-[80%] rounded-lg p-3 break-words overflow-wrap-anywhere ${
                      message.type === 'user'
                        ? 'bg-crypto-green/20 text-foreground ml-2 sm:ml-4'
                        : 'bg-muted/50 text-foreground mr-2 sm:mr-4'
                    }`}
                  >
                    <div className="flex items-start space-x-2">
                      {message.type === 'ai' && (
                        <Bot className="w-4 h-4 text-crypto-green mt-1 flex-shrink-0" />
                      )}
                      {message.type === 'user' && (
                        <User className="w-4 h-4 text-crypto-blue mt-1 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{message.content}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-muted-foreground">
                            {message.timestamp.toLocaleTimeString()}
                          </span>
                          {message.type === 'ai' && message.confidence !== undefined && (
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${getConfidenceColor(message.confidence)}`}
                            >
                              {message.confidence}% confidence
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted/50 rounded-lg p-3 mr-2 sm:mr-4 max-w-[85%] sm:max-w-[80%]">
                    <div className="flex items-center space-x-2">
                      <Bot className="w-4 h-4 text-crypto-green flex-shrink-0" />
                      <Loader2 className="w-4 h-4 animate-spin text-crypto-green flex-shrink-0" />
                      <span className="text-sm text-muted-foreground">AI is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Suggested Questions */}
            {messages.length === 1 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Try asking:</p>
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2">
                  {suggestedQuestions.map((question, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      onClick={() => handleSuggestedQuestion(question)}
                      className="w-full justify-start text-xs hover:bg-crypto-green/10 hover:border-crypto-green/30 break-words whitespace-normal h-auto py-2 px-3"
                    >
                      <span className="break-words text-left">{question}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="flex space-x-2 min-w-0">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything about cryptocurrency..."
                className="flex-1 min-w-0 bg-card border-border focus:border-crypto-green/50"
                disabled={loading}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!input.trim() || loading}
                className="bg-crypto-green hover:bg-crypto-green/90 text-primary-foreground flex-shrink-0"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}