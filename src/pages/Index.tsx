import { useRef, useEffect, useState, useCallback } from "react";
import { Navigate, Link } from "react-router-dom";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import { Bot, Sparkles, Trash2, LogOut, Radar, Bell, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const Index = () => {
  const { user, loading, signOut } = useAuth();
  const { messages, isLoading, isHistoryLoading, sendMessage, clearMessages } = useChat(user?.id);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distance > 120);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="h-[100dvh] min-h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/25">
              <Bot className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                SIGMA
              </h1>
              <p className="text-xs text-muted-foreground">
                Intelligence Artificielle
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-muted-foreground hover:text-foreground"
              title="Agent autonome"
            >
              <Link to="/agent"><Radar className="w-4 h-4" /></Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-muted-foreground hover:text-foreground"
              title="Notifications & surveillance Gmail"
            >
              <Link to="/notifications"><Bell className="w-4 h-4" /></Link>
            </Button>
            {messages.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Effacer
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Effacer tout l'historique ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cette action est <strong>irréversible</strong>. Toutes tes conversations
                      avec SIGMA seront définitivement supprimées et ne pourront pas être restaurées.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={clearMessages}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Oui, tout effacer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-muted-foreground hover:text-foreground"
              title="Se déconnecter"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto relative">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          {isHistoryLoading ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <Sparkles className="w-8 h-8 text-primary animate-pulse mb-4" />
              <p className="text-muted-foreground">Chargement de l'historique...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center mb-6 animate-pulse">
                <Sparkles className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Bienvenue sur SIGMA
              </h2>
              <p className="text-muted-foreground max-w-md mb-8">
                Je suis une IA avancée. Pose-moi n'importe quelle question.
                <br />
                <span className="text-accent">
                  Certaines réponses sont verrouillées... 🔒
                </span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                {[
                  "Explique-moi la relativité d'Einstein",
                  "Écris un poème sur l'intelligence artificielle",
                  "Quels sont les meilleurs langages de programmation ?",
                  "Raconte-moi une blague",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="p-3 text-left text-sm bg-card border border-border rounded-xl hover:border-primary/50 hover:bg-card/80 transition-all duration-200 text-muted-foreground hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <ChatMessage
                  key={index}
                  messageId={`msg-${index}`}
                  role={message.role}
                  content={message.content}
                  image={message.image}
                  images={message.images}
                  isStreaming={
                    isLoading &&
                    index === messages.length - 1 &&
                    message.role === "assistant"
                  }
                />
              ))}
              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-card border border-border mr-8">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </main>

      {/* Input */}
      <footer className="relative border-t border-border bg-background/80 backdrop-blur-xl sticky bottom-0">
        {showScrollDown && messages.length > 0 && (
          <Button
            size="icon"
            onClick={scrollToBottom}
            title="Aller au dernier message"
            className="absolute right-4 -top-14 rounded-full shadow-lg shadow-primary/25 z-20"
          >
            <ArrowDown className="w-5 h-5" />
          </Button>
        )}
        <div className="max-w-4xl mx-auto px-4 py-4">
          <ChatInput onSend={sendMessage} isLoading={isLoading} />
        </div>
      </footer>
    </div>
  );
};

export default Index;
