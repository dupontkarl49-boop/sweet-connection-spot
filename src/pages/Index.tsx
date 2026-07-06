import { useRef, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { Bot, Sparkles, Trash2, LogOut, Menu } from "lucide-react";
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
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const { conversations, loading: convosLoading, createConversation, deleteConversation } =
    useConversations(user?.id);
  const { messages, isLoading, isHistoryLoading, sendMessage, clearMessages } = useChat(
    user?.id,
    conversationId
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-redirect to a conversation when landing on "/"
  useEffect(() => {
    if (!user || convosLoading || conversationId) return;
    if (conversations.length > 0) {
      navigate(`/c/${conversations[0].id}`, { replace: true });
    }
  }, [user, convosLoading, conversationId, conversations, navigate]);

  const handleNew = async () => {
    const id = await createConversation();
    if (id) {
      setSidebarOpen(false);
      navigate(`/c/${id}`);
    }
  };

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
    <div className="min-h-screen bg-background flex">
      {/* Sidebar - desktop */}
      <div className="hidden md:flex md:sticky md:top-0 md:h-screen">
        <ConversationSidebar
          conversations={conversations}
          activeId={conversationId}
          onNew={handleNew}
          onDelete={deleteConversation}
        />
      </div>

      {/* Sidebar - mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="absolute inset-y-0 left-0 h-full">
            <ConversationSidebar
              conversations={conversations}
              activeId={conversationId}
              onNew={handleNew}
              onDelete={deleteConversation}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
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
            {messages.length > 0 && conversationId && (
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
                    <AlertDialogTitle>Effacer les messages de cette conversation ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cette action est <strong>irréversible</strong>. Tous les messages de cette
                      conversation seront définitivement supprimés.
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
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          {!conversationId ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center mb-6">
                <Sparkles className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Bienvenue sur SIGMA</h2>
              <p className="text-muted-foreground max-w-md mb-6">
                Crée ta première conversation pour commencer.
              </p>
              <Button onClick={handleNew} className="bg-primary text-primary-foreground hover:bg-primary/90">
                Nouvelle conversation
              </Button>
            </div>
          ) : isHistoryLoading ? (
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
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </main>

      {/* Input */}
      <footer className="border-t border-border bg-background/80 backdrop-blur-xl sticky bottom-0">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <ChatInput onSend={sendMessage} isLoading={isLoading || !conversationId} />
        </div>
      </footer>
      </div>
    </div>
  );
};

export default Index;
