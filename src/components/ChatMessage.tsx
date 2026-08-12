import { cn } from "@/lib/utils";
import { Bot, User, Volume2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeech } from "@/hooks/useSpeech";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  image?: string;
  images?: string[];
  isStreaming?: boolean;
  messageId?: string;
}

export function ChatMessage({ role, content, image, images, isStreaming, messageId }: ChatMessageProps) {
  const isUser = role === "user";
  const allImages = images && images.length > 0 ? images : image ? [image] : [];
  const { supported, isSpeaking, speak, stop } = useSpeech(messageId ?? content.slice(0, 32));

  return (
    <div
      className={cn(
        "flex gap-4 p-4 rounded-xl transition-all duration-300",
        isUser
          ? "bg-secondary/50 ml-8"
          : "bg-card border border-border mr-8"
      )}
    >
      <div
        className={cn(
          "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
          isUser
            ? "bg-muted"
            : "bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30"
        )}
      >
        {isUser ? (
          <User className="w-5 h-5 text-muted-foreground" />
        ) : (
          <Bot className="w-5 h-5 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-medium text-muted-foreground">
            {isUser ? "Toi" : "SIGMA"}
          </p>
          {!isUser && supported && !isStreaming && content.trim() && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-primary"
              title={isSpeaking ? "Arrêter la lecture" : "Écouter la réponse"}
              onClick={() => (isSpeaking ? stop() : speak(content))}
            >
              {isSpeaking ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
        {allImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {allImages.map((img, index) => (
              <img
                key={index}
                src={img}
                alt={`Image envoyée ${index + 1}`}
                className="max-w-[8rem] max-h-32 rounded-lg border border-border object-contain"
              />
            ))}
          </div>
        )}
        <div className="text-foreground whitespace-pre-wrap break-words">
          {content}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse rounded-sm" />
          )}
        </div>
      </div>
    </div>
  );
}
